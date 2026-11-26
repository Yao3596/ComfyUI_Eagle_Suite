"""Native classic/Nodes 2.0 API profile selector; fixture API, no model calls."""
import argparse
import ast
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from check_gallery_browser_layout import install_fixture, ROOT, EAGLE_PREFIX


def loader_definition():
    path=ROOT/'eagle_suite/api_key_node.py'
    cls=next(n for n in ast.parse(path.read_text('utf-8-sig')).body if isinstance(n,ast.ClassDef) and n.name=='EagleAPILoader')
    method=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='INPUT_TYPES')
    inputs=ast.literal_eval(next(n.value for n in method.body if isinstance(n,ast.Return)))
    return {'EagleAPILoader':{'name':'EagleAPILoader','display_name':'API configuration loader','description':'',
        'python_module':'custom_nodes.ComfyUI_Eagle_Suite','input':inputs,'input_order':{k:list(v) for k,v in inputs.items()},
        'output':['STRING','STRING','STRING','API_CONFIG','STRING'], 'output_name':['api_key','base_url','model','api_config','model_type'],
        'output_is_list':[False]*5,'category':'Eagle/API','output_node':True}}


def run(browser,frontend,artifacts,modern):
    mode='nodes2' if modern else 'classic'
    context=browser.new_context(viewport={'width':1500,'height':1000})
    page=context.new_page();errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    install_fixture(page,'http://127.0.0.1:8189',modern,False,'legacy',frontend)
    calls=[]
    def api(route):
        path=urlparse(route.request.url).path
        if path in ('/extensions','/api/extensions'):
            return route.fulfill(json=[EAGLE_PREFIX+'js/api_key_input.js'])
        if path in ('/object_info','/api/object_info'):
            return route.fulfill(json=loader_definition())
        if path=='/api_loader/profiles':
            return route.fulfill(json={'success':True,'profiles':['Profile A','Profile B'],
                'active_profile':'Profile A','config_revision':'fixture','items':[]})
        if path.startswith('/api_loader/') or path in ('/prompt','/api/prompt'):
            calls.append(path)
            return route.fulfill(json={'success':False,'error':'No writes/model requests allowed in fixture'})
        return route.fallback()
    page.route('**/*',api)
    try:
        page.goto('http://127.0.0.1:8189',wait_until='domcontentloaded')
        page.wait_for_function('Boolean(window.LiteGraph?.registered_node_types?.EagleAPILoader)')
        page.evaluate("""()=>{const a=window.comfyAPI.app.app;a.graph.clear();
          const n=window.LiteGraph.createNode('EagleAPILoader');n.pos=[180,130];a.graph.add(n);n.setSize([430,450]);
          a.canvas.ds.scale=1;a.canvas.ds.offset=[20,20];a.canvas.setDirty(true,true);}
        """)
        page.wait_for_function("window.comfyAPI.app.app.graph._nodes[0].widgets.find(w=>w.name==='model_name')?.options?.values?.includes('Profile B')")
        page.wait_for_timeout(100)
        state=page.evaluate("""()=>{const n=window.comfyAPI.app.app.graph._nodes[0],w=n.widgets.find(w=>w.name==='model_name');
          return {name:w.name,type:w.type,value:w.value,last_y:w.last_y,constructor:w.constructor.name,
            draw:String(w.draw).slice(0,160),mouse:String(w.mouse||w.onMouse).slice(0,160),size:Array.from(n.size)};}""")
        print(json.dumps({'mode':mode,'widget':state}),flush=True)
        if modern:
            page.locator('.lg-node').get_by_role('combobox').click()
            page.get_by_role('option',name='Profile B',exact=True).click()
        else:
            point=page.evaluate("""()=>{const a=window.comfyAPI.app.app,n=a.graph._nodes[0],w=n.widgets.find(w=>w.name==='model_name');
              const r=a.canvas.canvas.getBoundingClientRect(),d=a.canvas.ds;
              return {x:r.x+(n.pos[0]+n.size[0]*.65+d.offset[0])*d.scale,y:r.y+(n.pos[1]+w.last_y+10+d.offset[1])*d.scale};}""")
            page.mouse.click(point['x'],point['y'])
            page.wait_for_selector('.litecontextmenu',timeout=1500)
            page.locator('.litecontextmenu .litemenu-entry').filter(has_text='Profile B').click()
        page.wait_for_function("window.comfyAPI.app.app.graph._nodes[0].widgets.find(w=>w.name==='model_name')?.value==='Profile B'")
        prompt=page.evaluate("async()=>{const a=window.comfyAPI.app.app,p=await a.graphToPrompt();return p.output[a.graph._nodes[0].id]}")
        assert prompt['inputs']['model_name']=='Profile B',prompt
        assert not any(name.startswith('model_name#') for name in prompt['inputs']),prompt
        page.evaluate("async()=>{const a=window.comfyAPI.app.app;await a.loadGraphData(a.graph.serialize())}")
        page.wait_for_function("(()=>{const w=window.comfyAPI.app.app.graph._nodes[0].widgets.find(w=>w.name==='model_name');return w?.value==='Profile B'&&w.options.values?.includes('Profile B')&&w.constructor.name==='ComboWidget'})()")
        # Migrate a workflow saved by the earlier duplicate-name implementation.
        page.evaluate("""async()=>{const a=window.comfyAPI.app.app,s=a.graph.serialize();
          s.nodes[0].widgets_values_named={'model_name#1':'Profile B'};s.nodes[0].widgets_values[0]='Profile A';
          await a.loadGraphData(s);}""")
        page.wait_for_function("(()=>{const w=window.comfyAPI.app.app.graph._nodes[0].widgets.find(w=>w.name==='model_name');return w?.value==='Profile B'&&w.options.values?.includes('Profile B')})()")
        migrated=page.evaluate("async()=>{const a=window.comfyAPI.app.app,p=await a.graphToPrompt();return p.output[a.graph._nodes[0].id].inputs}")
        assert migrated['model_name']=='Profile B',migrated
        assert not any(name.startswith('model_name#') for name in migrated),migrated
        assert not calls,calls
        assert not errors,errors
        page.screenshot(path=str(artifacts/f'{mode}-selector.png'))
        print(json.dumps({'mode':mode,'switch':'PASS','prompt_name':'model_name','reload':'PASS','legacy_name_migration':'PASS'}),flush=True)
    except:
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
