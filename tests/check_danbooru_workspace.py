"""Native frontend checks with fixture data; never queues a workflow/model call."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from check_gallery_browser_layout import install_fixture


def post(number):
    return {'id':number,'preview_file_url':'','image_width':640,'image_height':480,
            'tag_string':'standing blue_hair','tag_string_general':'standing blue_hair',
            'rating':'g','score':5,'fav_count':3}


def run(browser,frontend,artifacts,modern):
    mode='nodes2' if modern else 'classic'
    context=browser.new_context(viewport={'width':1800,'height':1100},permissions=['clipboard-read','clipboard-write'])
    page=context.new_page();errors=[]
    model_requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda request:model_requests.append(request.url) if request.method=='POST' and urlparse(request.url).path in ('/prompt','/api/prompt','/danbooru_search/gacha') else None)
    install_fixture(page,'http://127.0.0.1:8189',modern,False,'legacy',frontend)
    reads={'settings':0,'library':0}
    post_requests=[]
    annotations={'pending':2,'approved':1}
    translation={'label':'微笑','source':'model','model':'annotation-model'}
    def data_route(route):
        path=urlparse(route.request.url).path
        if path in ('/danbooru_search/settings','/danbooru_search/library'):
            if route.request.method=='POST':
                body=route.request.post_data_json
                if body.get('action')=='review':annotations['pending']-=1;annotations['approved']+=1
                if body.get('action')=='edit_translation':translation.update(label=body['cn_name'],source='manual',model='manual:ui')
                return route.fulfill(json={'success':True})
            reads[path.rsplit('/',1)[-1]]+=1
            pending=[{'name':name,'cn_name':'坐姿','facets':[],'rating':'safe','confidence':.9,'note':'fixture',
                      'model':'annotation-model','updated_at':'2026-11-20T08:00:00Z','status':'pending'}
                     for name in ['sitting','standing'][:annotations['pending']]]
            return route.fulfill(json={'success':True,'settings':{},'facets':{},'bootstrap':{'ready':True},
                'status':{'total':100,'translated':50,'official':100,'groups':2,'annotations':annotations,
                          'last_annotation_update':'2026-11-20T08:00:00Z'},'job':{'running':False},'pending':pending})
        if path=='/danbooru_search/translate_tags_batch':
            tags=route.request.post_data_json.get('tags',[])
            return route.fulfill(json={'success':True,'translations':{t:translation['label'] if t=='smile' else '' for t in tags},
                'metadata':{'smile':{'cn_name':translation['label'],'kind':'expression','facets':[],'rating':'safe','nsfw':0,
                    'annotation_source':translation['source'],'annotation_model':translation['model'],'annotation_status':'approved',
                    'annotation_confidence':.94 if translation['source']=='model' else None,
                    'translation_manual':translation['source']=='manual','annotation_updated_at':'2026-11-20T08:00:00Z'}} if 'smile' in tags else {}})
        if path=='/danbooru_search/api/posts':
            body=route.request.post_data_json
            post_requests.append((body.get('tags'),body.get('page',1)))
            number=body.get('page',1)
            large=body.get('tags')=='large'
            return route.fulfill(json={'success':True,'posts':[post(i) for i in (range(1000) if large else range((number-1)*40,number*40))],
                                      'has_more':not large and number<6})
        return route.fallback()
    page.route('**/danbooru_search/**',data_route)
    try:
        page.goto('http://127.0.0.1:8189',wait_until='domcontentloaded')
        page.wait_for_function('Boolean(window.LiteGraph?.registered_node_types?.DanbooruVueSearchNode)')
        page.evaluate("""() => {
          const app=window.comfyAPI.app.app;app.graph.clear();
          const node=window.LiteGraph.createNode('DanbooruVueSearchNode');node.pos=[100,80];app.graph.add(node);node.setSize([1200,850]);
          app.canvas.ds.scale=0.9;app.canvas.ds.offset=[20,30];app.canvas.setDirty(true,true);
        }""")
        page.wait_for_selector('.dbg-input');page.wait_for_timeout(200)
        assert reads=={'settings':1,'library':1},('initial shared reads',reads)
        page.locator('.dbg-input').fill('large');page.locator('.dbg-input').press('Enter')
        page.wait_for_selector('.dbg-card');page.wait_for_timeout(100)
        assert '1000' in page.locator('.dbg-page-info').inner_text()
        assert 0<page.locator('.dbg-card').count()<50,('rendered cards',page.locator('.dbg-card').count())
        initial=page.locator('.dbg-card').first.get_attribute('data-post-id')
        page.locator('.dbg-card').first.click()
        camera=page.evaluate('()=>{const d=window.comfyAPI.app.app.canvas.ds;return[d.scale,...d.offset]}')
        box=page.locator('.dbg-grid').bounding_box()
        page.mouse.move(box['x']+5,box['y']+45);page.mouse.wheel(0,500);page.wait_for_timeout(100)
        assert page.locator('.dbg-grid').evaluate('el=>el.scrollTop')>0
        assert page.evaluate('()=>{const d=window.comfyAPI.app.app.canvas.ds;return[d.scale,...d.offset]}')==camera
        page.locator('.dbg-grid').evaluate('el=>{el.scrollTop=el.scrollHeight/2}')
        page.wait_for_timeout(120)
        assert page.locator(f'.dbg-card[data-post-id="{initial}"]').count()==0
        selected=page.evaluate("JSON.parse(window.comfyAPI.app.app.graph._nodes[0].widgets.find(w=>w.name==='selection_data').value).selections")
        assert len(selected)==1 and str(selected[0]['id'])==initial
        page.locator('.dbg-grid').evaluate('el=>{el.scrollTop=0}')
        page.wait_for_timeout(120)
        assert page.locator(f'.dbg-card[data-post-id="{initial}"].selected').count()==1
        state=page.evaluate("""()=>{const n=window.comfyAPI.app.app.graph._nodes[0],r=document.querySelector('.dbs-root');return{size:Array.from(n.size),height:r.clientHeight,node:r.closest('.lg-node')?.clientHeight}}""")
        assert state['height']<=850 and (not modern or state['node']<=882),state

        page.locator('.dbg-input').fill('pages');page.locator('.dbg-input').press('Enter')
        page.wait_for_function("document.querySelector('.dbg-page-info')?.textContent.includes('40')")
        for count in (80,120,160,200,240):
            page.locator('.dbg-grid').evaluate('el=>{el.scrollTop=el.scrollHeight}')
            page.wait_for_function('(count)=>document.querySelector(".dbg-page-info")?.textContent.includes(String(count))',arg=count,timeout=8000)
            page.wait_for_timeout(50)
            assert page.locator('.dbg-card').count()<50

        # Simulate a service that ignores abort: sequence ownership must still
        # discard the late result, using the actual Vue search component.
        page.evaluate("""() => {
          const original=window.fetch;window.pendingSearch=[];
          window.fetch=(url,options)=>url==='/danbooru_search/search'
            ?new Promise(resolve=>window.pendingSearch.push({query:JSON.parse(options.body).query,resolve}))
            :original(url,options);
        }""")
        query=page.locator('.dbs-left .dbs-input')
        query.fill('old');query.press('Enter')
        page.wait_for_function('window.pendingSearch.length===1')
        query.fill('new');query.press('Enter')
        page.wait_for_function('window.pendingSearch.length===2')
        for index,tag in ((1,'new_tag'),(0,'old_tag')):
            page.evaluate("""({index,tag})=>window.pendingSearch[index].resolve(new Response(JSON.stringify({success:true,results:[{tag,cn_name:'测试',category:'general'}]}),{headers:{'Content-Type':'application/json'}}))""",{'index':index,'tag':tag})
            page.wait_for_timeout(80)
        assert 'new_tag' in page.locator('.dbs-left .dbs-results').inner_text()
        assert 'old_tag' not in page.locator('.dbs-left .dbs-results').inner_text()
        snapshot={'version':1,'generated_at':'2026-11-20T10:00:00Z','tags':'blue_hair, (standing:1.25)',
                  'sdxl_prompt':'blue hair, (standing:1.25)','anima_prompt':'blue hair, standing, viewed from above',
                  'tag_count':2,'selected_image_count':1,'image_count':1,
                  'tag_sources':[{'tag':'blue_hair','sources':['character','image']}]}
        snapshot['draft_revision']=page.evaluate("JSON.parse(window.comfyAPI.app.app.graph._nodes[0].widgets.find(w=>w.name==='selection_data').value).draft_revision||null")
        # First execution is still running while the user edits its inputs.
        page.locator('.dbte-add input').fill('in_flight_edit');page.locator('.dbte-add input').press('Enter')
        page.evaluate("snapshot=>window.comfyAPI.app.app.graph._nodes[0].onExecuted({danbooru_output:[JSON.stringify(snapshot)]})",snapshot)
        page.wait_for_selector('.dbs-output-text',timeout=1500)
        assert '已修改' in page.locator('.dbs-output-status').inner_text(), 'late first result must not mark newer edits clean'
        # A result from the matching version may be marked current.
        snapshot['draft_revision']=page.evaluate("JSON.parse(window.comfyAPI.app.app.graph._nodes[0].widgets.find(w=>w.name==='selection_data').value).draft_revision||null")
        page.evaluate("snapshot=>window.comfyAPI.app.app.graph._nodes[0].onExecuted({danbooru_output:[JSON.stringify(snapshot)]})",snapshot)
        page.wait_for_timeout(50)
        assert '已修改' not in page.locator('.dbs-output-status').inner_text()
        assert page.locator('.dbs-output-text').input_value()==snapshot['anima_prompt']
        page.locator('.dbs-output button[data-format="tags"]').click()
        assert page.locator('.dbs-output-text').input_value()==snapshot['tags']
        before_switch=page.locator('.dbg-grid').evaluate('el=>el.scrollTop')
        page.locator('.dbs-output-copy').click()
        assert page.evaluate('navigator.clipboard.readText()')==snapshot['tags']
        page.locator('.dbte-add input').fill('smile')
        page.locator('.dbte-add input').press('Enter')
        assert '已修改' in page.locator('.dbs-output-status').inner_text()
        assert page.locator('.dbs-output-text').input_value()==snapshot['tags']
        page.locator('.dbs-task-tab[data-task="reverse"]').click(timeout=1500)
        assert page.locator('.dbs-reverse-panel').is_visible()
        assert page.locator('.dbte-auto input:checked').count()==0
        scope=page.locator('.dbs-reverse-scopes input').first
        scope.set_checked(False)
        page.locator('.dbs-task-tab[data-task="gacha"]').click()
        page.locator('.dbs-gacha-context textarea').fill('sunset in a garden')
        page.locator('.dbs-gacha-context textarea').blur()
        page.locator('.dbs-runtime-field select').select_option('daily')
        page.locator('.dbs-task-tab[data-task="tags"]').click()
        assert '240' in page.locator('.dbg-page-info').inner_text()
        assert page.locator('.dbg-input').input_value()=='pages'
        page.wait_for_timeout(100)
        assert abs(page.locator('.dbg-grid').evaluate('el=>el.scrollTop')-before_switch)<2
        assert len(post_requests)==7,post_requests
        page.locator('.dbs-task-tab[data-task="reverse"]').click()
        assert not page.locator('.dbs-reverse-scopes input').first.is_checked()
        page.locator('.dbs-task-tab[data-task="gacha"]').click()
        page.evaluate("async()=>{const a=window.comfyAPI.app.app;await a.loadGraphData(a.graph.serialize())}")
        page.wait_for_selector('.dbs-output-text')
        assert page.locator('.dbs-output-text').input_value()==snapshot['tags']
        assert '已修改' in page.locator('.dbs-output-status').inner_text()
        page.wait_for_function("document.querySelector('.dbs-task-tab[data-task=gacha]')?.classList.contains('primary')")
        page.wait_for_function("document.querySelector('.dbs-gacha-context textarea')?.value==='sunset in a garden'")
        assert page.locator('.dbs-runtime-field select').input_value()=='daily'
        page.locator('.dbte-chip').filter(has_text='smile').click(button='right')
        page.wait_for_selector('.dbte-annotation-meta',timeout=1500)
        assert '模型采用' in page.locator('.dbte-annotation-meta').inner_text()
        assert '94%' in page.locator('.dbte-annotation-meta').inner_text()
        page.evaluate("""()=>{const original=window.fetch;let used=false;
          window.fetch=(url,options)=>url==='/danbooru_search/translate_tags_batch'&&!used
            ?(used=true,new Promise(resolve=>window.oldTranslation=resolve)):original(url,options);
        }""")
        page.get_by_role('button',name='回读词库注释',exact=True).click()
        page.wait_for_function('Boolean(window.oldTranslation)')
        page.locator('.dbte-translation input').fill('人工笑容')
        page.locator('.dbte-translation input').press('Tab')
        page.locator('.dbte-translation button').click()
        page.wait_for_function("document.querySelector('.dbte-annotation-meta')?.textContent.includes('人工修订')")
        page.evaluate("""()=>window.oldTranslation(new Response(JSON.stringify({success:true,translations:{smile:'过期模型译名'},
          metadata:{smile:{cn_name:'过期模型译名',kind:'expression',annotation_source:'model',annotation_model:'old-model',annotation_status:'approved'}}}),
          {headers:{'Content-Type':'application/json'}}))""")
        page.wait_for_timeout(100)
        page.locator('.dbte-inspector .dbte-remove').click()
        page.locator('.dbte-add input').fill('smile');page.locator('.dbte-add input').press('Enter')
        page.wait_for_timeout(100)
        assert '人工笑容' in page.locator('.dbte-chip').filter(has_text='smile').inner_text()
        page.locator('.dbs-annotation-status').click()
        page.wait_for_selector('.dbs-status-card')
        assert '2026-11-20' in page.locator('.dbs-status-card').first.inner_text()
        assert 'annotation-model' in page.locator('.dbs-status-card').first.inner_text()
        page.locator('.dbs-status-card').first.get_by_role('button',name='核对无误，采用').click()
        page.wait_for_function("document.querySelector('.dbs-annotation-status')?.textContent.includes('待审核 1')")
        page.screenshot(path=str(artifacts/f'{mode}-annotation-review.png'))
        page.locator('.dbs-settings-head button').click()
        page.evaluate("async()=>{const a=window.comfyAPI.app.app;await a.loadGraphData(a.graph.serialize())}")
        page.wait_for_function("[...document.querySelectorAll('.dbte-chip')].some(el=>el.textContent.includes('人工笑容'))")
        page.locator('.dbte-chip').filter(has_text='smile').click(button='right')
        assert '人工修订' in page.locator('.dbte-annotation-meta').inner_text()
        page.screenshot(path=str(artifacts/f'{mode}-annotations.png'))
        page.locator('.dbs-task-tab[data-task="tags"]').click()
        page.locator('.dbg-input').fill('large');page.locator('.dbg-input').press('Enter')
        page.wait_for_selector('.dbg-card')
        assert not model_requests,model_requests
        assert not errors,errors
        page.screenshot(path=str(artifacts/f'{mode}-performance.png'))
        print(json.dumps({'mode':mode,'virtualized_1000':True,'pages':6,'selection_retained':True,'latest_search':True,'execution_snapshot':True,'task_modes':True,'annotation_review':True,'manual_priority':True,'wheel':True,'model_calls':0}))
    except Exception as error:
        print(ascii(error),flush=True)
        print(json.dumps({'requests':post_requests,'grid':page.evaluate("""()=>{const g=document.querySelector('.dbg-grid');return{loaded:document.querySelector('.dbg-page-info')?.textContent,top:g?.scrollTop,height:g?.clientHeight,scroll:g?.scrollHeight,cards:document.querySelectorAll('.dbg-card').length}}""")}),flush=True)
        page.screenshot(path=str(artifacts/f'{mode}-failure.png'),timeout=5000)
        raise
    finally:context.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend-dir',type=Path,required=True)
    parser.add_argument('--artifacts',type=Path,required=True)
    args=parser.parse_args();args.artifacts.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        with p.chromium.launch(channel='chrome',headless=True) as browser:
            for modern in (True,False):run(browser,args.frontend_dir,args.artifacts,modern)
