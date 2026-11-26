"""H3 reference drag/drop against native renderers, with isolated upload fixtures."""
import argparse
import ast
import json
import io
from pathlib import Path
from PIL import Image, PngImagePlugin
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from check_gallery_browser_layout import install_fixture, ROOT, EAGLE_PREFIX

_image=io.BytesIO();Image.new('RGB',(8,8),'#6f91bc').save(_image,format='PNG');PNG=_image.getvalue()


def definitions():
    path=ROOT/'eagle_suite/h3_director_node.py'
    cls=next(n for n in ast.parse(path.read_text('utf-8-sig')).body if isinstance(n,ast.ClassDef) and n.name=='EagleH3DirectorNode')
    method=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='INPUT_TYPES')
    inputs=ast.literal_eval(next(n.value for n in method.body if isinstance(n,ast.Return)))
    return {'EagleH3DirectorNode':{'name':'EagleH3DirectorNode','display_name':'H3 Director','description':'',
        'python_module':'custom_nodes.ComfyUI_Eagle_Suite','input':inputs,'input_order':{k:list(v) for k,v in inputs.items()},
        'output':['H3_CHAIN_PLAN','STRING','INT','INT','INT','INT','H3_MEDIA_BUNDLE','STRING'],
        'output_name':['plan','summary','clip_count','width','height','video_blend_frames','media_bundle','context_loop_plan_json'],
        'output_is_list':[False]*8,'category':'Eagle Suite/H3','output_node':False}}


def run(browser,frontend,artifacts,modern):
    mode='nodes2' if modern else 'classic'
    context=browser.new_context(viewport={'width':2100,'height':1300})
    page=context.new_page();errors=[];uploads=[];unexpected=[];requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda request: requests.append((request.method,urlparse(request.url).path)) if request.method=='POST' else None)
    install_fixture(page,'http://127.0.0.1:8189',modern,False,'legacy',frontend)
    def api(route):
        path=urlparse(route.request.url).path
        if path.startswith('/api/h3_director/') or path.startswith('/api/eaglePromptPresets/'):
            path=path.removeprefix('/api')
        if path in ('/extensions','/api/extensions'):
            return route.fulfill(json=[EAGLE_PREFIX+'js/h3_director.js'])
        if path in ('/object_info','/api/object_info'):return route.fulfill(json=definitions())
        if path=='/h3_director/upload_media':
            uploads.append(route.request.post_data_buffer)
            return route.fulfill(json={'success':True,'item':{'id':f'media-{len(uploads)}','type':'image',
                'filename':f'h3_director/test-{len(uploads)}.png','originalName':'reference.png',
                'source':'input','managed':True}})
        if path in ('/h3_director/media','/view','/api/view'):return route.fulfill(content_type='image/png',body=PNG)
        if path=='/eaglePromptPresets/director_skills':
            return route.fulfill(json={'success':True,'items':[],'source':'fixture','data':[]})
        if path.startswith('/h3_director/') or path in ('/prompt','/api/prompt'):
            unexpected.append(path);return route.fulfill(json={'success':False,'error':'Fixture blocks generation'})
        return route.fallback()
    page.route('**/*',api)
    try:
        page.goto('http://127.0.0.1:8189',wait_until='domcontentloaded')
        page.wait_for_function('Boolean(window.LiteGraph?.registered_node_types?.EagleH3DirectorNode)')
        page.evaluate("""()=>{const a=window.comfyAPI.app.app;a.graph.clear();const n=window.LiteGraph.createNode('EagleH3DirectorNode');
          n.pos=[60,40];a.graph.add(n);n.setSize([1800,1100]);a.canvas.ds.scale=.9;a.canvas.ds.offset=[20,20];a.canvas.setDirty(true,true);
          window.dragEvents=[];for(const type of ['dragenter','dragover','drop'])document.addEventListener(type,e=>{
            window.dragEvents.push({type,target:e.target.className,types:[...(e.dataTransfer?.types||[])],files:e.dataTransfer?.files?.length});},true);}
        """)
        page.locator('.h3d-tabs .h3d-tab').filter(has_text='参考').click()
        zone=page.locator('.h3d-media-dropzone');zone.wait_for(state='visible')
        fixture=artifacts/'reference.png'
        metadata=PngImagePlugin.PngInfo()
        metadata.add_text('workflow',json.dumps({'version':.4,'nodes':[],'links':[],'groups':[],'config':{},'extra':{},'last_node_id':0,'last_link_id':0}))
        Image.new('RGB',(8,8),'#6f91bc').save(fixture,format='PNG',pnginfo=metadata)
        box=zone.bounding_box();point={'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}
        client=context.new_cdp_session(page)
        try:
            data={'items':[],'files':[str(fixture.resolve())],'dragOperationsMask':1}
            for event in ('dragEnter','dragOver','drop'):
                client.send('Input.dispatchDragEvent',{'type':event,**point,'data':data})
            page.wait_for_function("document.querySelectorAll('.h3d-media-detail').length===1",timeout=2500)
            chrome=page.evaluate("""()=>{const a=window.comfyAPI.app.app,n=a.graph._nodes[0],d=a.canvas.ds,r=a.canvas.canvas.getBoundingClientRect();
              return {x:r.x+(n.pos[0]+n.size[0]/2+d.offset[0])*d.scale,y:r.y+(n.pos[1]+15+d.offset[1])*d.scale};}""")
            for event in ('dragEnter','dragOver','drop'):
                client.send('Input.dispatchDragEvent',{'type':event,**chrome,'data':data})
            page.wait_for_function("document.querySelectorAll('.h3d-media-detail').length===2",timeout=2500)
            # The reference tab has blank space outside its dashed drop box.
            # A PNG generated by ComfyUI must still become a reference here,
            # rather than replacing the graph with its embedded workflow.
            body=zone.locator('xpath=ancestor::div[contains(@class,"h3d-scroll-box")]').bounding_box()
            blank={'x':body['x']+body['width']/2,'y':min(body['y']+body['height']-12,1240)}
            for event in ('dragEnter','dragOver','drop'):
                client.send('Input.dispatchDragEvent',{'type':event,**blank,'data':data})
            page.wait_for_function("document.querySelectorAll('.h3d-media-detail').length===3",timeout=2500)
        finally:client.detach()
        assert len(uploads)==3,('uploads',len(uploads))
        assert page.evaluate('window.comfyAPI.app.app.graph._nodes.length')==1
        page.evaluate("""() => {
          const n = window.comfyAPI.app.app.graph._nodes[0];
          const widget = n.widgets.find(w => w.name === 'h3_state');
          const data = JSON.parse(n._h3FlushState());
          data.scenes[0].preamble = 'Use <Picture 1> and <picture 3>';
          data.scenes[0].shots = [{id:1, content:'Show <Picture 2> with @ref1'}];
          data.scenes[0].disabledTokens = ['<Picture 3>'];
          data.project.foundation = 'Style of <Picture 1>';
          widget.value = JSON.stringify(data);
          n._h3ReloadState();
        }""")
        page.locator('.h3d-tabs .h3d-tab').filter(has_text='参考').click()
        first=page.locator('.h3d-media-detail').nth(0)
        last=page.locator('.h3d-media-detail').nth(2)
        first.drag_to(last,source_position={'x':20,'y':20},target_position={'x':20,'y':20})
        order=page.evaluate("""()=>{const n=window.comfyAPI.app.app.graph._nodes[0];n._h3FlushState();
          return JSON.parse(n.widgets.find(w=>w.name==='h3_state').value).project.mediaRefs.map(item=>item.id);}""")
        assert order==['media-2','media-3','media-1'],('reorder',order)
        page.evaluate("""async()=>{const a=window.comfyAPI.app.app;await a.loadGraphData(a.graph.serialize());}""")
        page.locator('.h3d-tabs .h3d-tab').filter(has_text='参考').click()
        page.wait_for_function("document.querySelectorAll('.h3d-media-detail').length===3")
        restored=page.evaluate("""()=>{const n=window.comfyAPI.app.app.graph._nodes[0];n._h3FlushState();
          return JSON.parse(n.widgets.find(w=>w.name==='h3_state').value).project.mediaRefs.map(item=>item.id);}""")
        assert restored==order,('restored',restored)
        state=page.evaluate("JSON.parse(window.comfyAPI.app.app.graph._nodes[0]._h3FlushState())")
        assert state['scenes'][0]['preamble']=='Use <Picture 3> and <Picture 2>'
        assert state['scenes'][0]['shots'][0]['content']=='Show <Picture 1> with @ref3'
        assert state['scenes'][0]['disabledTokens']==['<Picture 2>']
        assert state['project']['foundation']=='Style of <Picture 3>'
        page.locator('.h3d-media-detail').last.get_by_role('button',name='移除').click()
        state=page.evaluate("JSON.parse(window.comfyAPI.app.app.graph._nodes[0]._h3FlushState())")
        assert state['scenes'][0]['shots'][0]['content']=='Show <Picture 1> with '
        assert state['project']['foundation']=='Style of '
        assert len(uploads)==3,'internal sorting/reload must not re-upload media'
        page.screenshot(path=str(artifacts/f'{mode}-drop.png'))
        # Outside the director, ComfyUI's normal PNG workflow import still runs.
        page.evaluate('()=>{window.oldH3Node=window.comfyAPI.app.app.graph._nodes[0];}')
        outside=context.new_cdp_session(page)
        try:
            for event in ('dragEnter','dragOver','drop'):
                outside.send('Input.dispatchDragEvent',{'type':event,'x':1950,'y':650,'data':data})
            page.wait_for_function('window.comfyAPI.app.app.graph._nodes.length===0',timeout=3500)
        finally:outside.detach()
        assert page.evaluate('!window.oldH3Node._h3ReceiveReferenceDrop && !window.oldH3Node._h3ReleaseReferenceDrop')
        assert len(uploads)==3,'canvas workflow import must not become a director upload'
        assert not unexpected,unexpected
        assert not errors,errors
        print(json.dumps({'mode':mode,'file_drop':'PASS','uploads':len(uploads),'reorder_reload':'PASS','canvas_import':'PASS','cleanup':'PASS'}),flush=True)
    except Exception as e:
        print(ascii(e),flush=True)
        print(json.dumps({'mode':mode,'uploads':len(uploads),'unexpected':unexpected,'errors':errors,
            'requests':requests,'events':page.evaluate('window.dragEvents||[]'),
            'status':page.locator('.h3d-root').inner_text()[-300:] if page.locator('.h3d-root').count() else 'H3 node disappeared'}),flush=True)
        page.screenshot(path=str(artifacts/f'{mode}-failure.png'))
        raise
    finally:context.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend-dir',type=Path,required=True)
    parser.add_argument('--artifacts',type=Path,required=True)
    args=parser.parse_args();args.artifacts.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        with p.chromium.launch(channel='chrome',headless=True) as browser:
            for modern in (False,True):run(browser,args.frontend_dir,args.artifacts,modern)
