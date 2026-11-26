"""Exercise the shared wheel contract and the actual Danbooru settings panel."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from check_gallery_browser_layout import install_fixture


def capture_listener_count(page):
    client=page.context.new_cdp_session(page)
    try:
        remote=client.send('Runtime.evaluate',{'expression':'document'})['result']['objectId']
        listeners=client.send('DOMDebugger.getEventListeners',{'objectId':remote})['listeners']
        return sum(item['type']=='wheel' and item['useCapture'] and item['passive'] for item in listeners)
    finally:
        client.detach()


def wheel(page, selector):
    pane=page.locator(selector)
    box=pane.bounding_box()
    assert box and pane.evaluate('el => el.scrollHeight > el.clientHeight'), selector
    before=page.evaluate('window.comfyAPI.app.app.canvas.ds.scale')
    page.mouse.move(box['x']+min(25,box['width']/2),box['y']+min(35,box['height']/2))
    page.mouse.wheel(0,280)
    page.wait_for_timeout(200)
    after=pane.evaluate('el => el.scrollTop')
    assert after>0, ('wheel did not scroll',selector,before,page.evaluate('window.comfyAPI.app.app.canvas.ds.scale'))
    assert page.evaluate('window.comfyAPI.app.app.canvas.ds.scale')==before, 'list wheel changed canvas zoom'


def run(browser,frontend,artifacts,modern):
    mode='nodes2' if modern else 'classic'
    context=browser.new_context(viewport={'width':1600,'height':1000})
    page=context.new_page()
    install_fixture(page,'http://127.0.0.1:8189',modern,False,'legacy',frontend)
    try:
        page.goto('http://127.0.0.1:8189',wait_until='domcontentloaded')
        page.wait_for_function('Boolean(window.LiteGraph?.registered_node_types?.DanbooruVueSearchNode)')
        page.evaluate("""() => {
          const app=window.comfyAPI.app.app; app.graph.clear();
          const node=window.LiteGraph.createNode('DanbooruVueSearchNode');
          node.pos=[100,80]; app.graph.add(node); node.setSize([960,720]);
          app.canvas.ds.scale=0.9; app.canvas.ds.offset=[20,30]; app.canvas.setDirty(true,true);
        }""")
        page.wait_for_selector('.dbs-root')
        page.locator('.dbs-root button[title^="Danbooru /"]').click()
        page.wait_for_selector('.dbs-settings-content')
        page.locator('.dbs-settings-nav button').nth(4).click()
        wheel(page,'.dbs-settings-content')
        assert capture_listener_count(page)==1, 'Eagle widgets must share one wheel listener'
        page.screenshot(path=str(artifacts/f'{mode}-danbooru.png'))

        # A late-mounted DOM/Svelte widget must get the same protection without
        # its node-specific extension importing or calling the scroll helper.
        for kind in ('EagleScrollAuditProbe','EagleScrollForeignProbe'):
            page.evaluate("""kind => {
              const app=window.comfyAPI.app.app; app.graph.clear();
              const node=window.LiteGraph.createNode(kind); node.pos=[100,80]; app.graph.add(node);
              const root=document.createElement('div'); root.style.cssText='contain:size;min-height:150px;height:220px;overflow:hidden';
              const pane=document.createElement('div'); pane.className='audit-scroll';
              pane.style.cssText='height:100%;overflow:auto';
              for(let i=0;i<80;i++){const row=document.createElement('p');row.textContent='Scroll row '+i;pane.append(row);}
              root.append(pane);
              node.addDOMWidget('late_widget','div',root,{serialize:false,hideInPanel:true,
                getMinHeight:()=>200,getMaxHeight:()=>600,getHeight:()=>220});
              node.setSize([700,400]); app.canvas.ds.scale=0.9; app.canvas.ds.offset=[20,30]; app.canvas.setDirty(true,true);
            }""",kind)
            page.wait_for_selector('.audit-scroll')
            if kind=='EagleScrollAuditProbe' or not modern:
                wheel(page,'.audit-scroll')
            else:
                box=page.locator('.audit-scroll').bounding_box()
                page.mouse.move(box['x']+25,box['y']+35)
                page.mouse.wheel(0,280); page.wait_for_timeout(150)
                assert page.locator('.audit-scroll').evaluate('el=>el.scrollTop')==0
                assert page.evaluate('window.comfyAPI.app.app.canvas.ds.scale')!=0.9
            assert capture_listener_count(page)==(1 if kind=='EagleScrollAuditProbe' else 0), 'node removal must release its wheel listener'
        print(json.dumps({'mode':mode,'danbooru_settings':'PASS','late_dom_widget':'PASS','foreign_scope':'PASS'}))
    except Exception as error:
        print(ascii(error),flush=True)
        page.screenshot(path=str(artifacts/f'{mode}-failure.png'),timeout=5000)
        raise
    finally:
        context.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend-dir',type=Path,required=True)
    parser.add_argument('--artifacts',type=Path,required=True)
    args=parser.parse_args();args.artifacts.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        with p.chromium.launch(channel='chrome',headless=True) as browser:
            for modern in (True,False): run(browser,args.frontend_dir,args.artifacts,modern)
