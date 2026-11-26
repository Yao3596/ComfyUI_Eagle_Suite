"""Execute the real node class without starting ComfyUI or loading models."""
import ast
import json
import logging
from pathlib import Path
import re
import time
import unittest
from unittest.mock import Mock
import torch


def namespace():
    path=Path(__file__).resolve().parents[1]/'eagle_suite/danbooru_search.py'
    tree=ast.parse(path.read_text('utf-8-sig'))
    body=[n for n in tree.body if isinstance(n,(ast.ClassDef,ast.FunctionDef)) and n.name in
          ('DanbooruVueSearchNode','_format_prompt_variant')]
    values={'json':json,'re':re,'torch':torch,'time':time,'logger':logging.getLogger('snapshot-test'),
            'load_settings':lambda:{'underscore_mode':'space','include_selected_image_tags':True},
            '_has_cjk':lambda text:bool(re.search(r'[\u3400-\u9fff]',str(text))),
            '_is_gacha_source':lambda item:str(item.get('source','')).startswith('gacha'),
            '_model_release_seen':[], '_run_library_port_fill':Mock(return_value={'status':'approved','applied':1})}
    exec(compile(ast.Module(body=body,type_ignores=[]),str(path),'exec'),values)
    return values


class OutputSnapshotTests(unittest.TestCase):
    def test_snapshot_is_the_exact_downstream_output_after_merge_and_weights(self):
        ns=namespace();reference=torch.zeros((1,8,8,3))
        data={'draft_revision':'queued-version-a','selected_tags':[{'tag':'standing','weight':1.25},{'tag':'smile'},{'tag':'ignored','enabled':False}],
              'selections':[{'tags':['standing','outdoor'],'tag_groups':{'general':['outdoor']}}]}
        value=ns['DanbooruVueSearchNode']().execute(json.dumps(data),character_tags='blue_hair, standing',reference_image=reference)
        self.assertIsInstance(value,dict,'normal execution must expose its real output snapshot')
        outputs=value['result'];snapshot=json.loads(value['ui']['danbooru_output'][0])
        self.assertEqual(len(outputs),5)
        self.assertIs(outputs[4],reference)
        self.assertEqual('blue hair, (standing:1.25), smile, outdoor',outputs[1])
        self.assertEqual([snapshot['tags'],snapshot['sdxl_prompt'],snapshot['anima_prompt']],list(outputs[1:4]))
        self.assertEqual(snapshot['tag_count'],4)
        self.assertEqual(snapshot['selected_image_count'],1)
        self.assertEqual(snapshot['draft_revision'],'queued-version-a')
        self.assertIn('character',snapshot['tag_sources'][1]['sources'])
        self.assertIn('image',snapshot['tag_sources'][1]['sources'])

    def test_reverse_phrases_and_existing_reverse_ui_are_retained(self):
        ns=namespace()
        ns['_run_reverse_inference']=Mock(return_value={'ok':True,'tags':[{'tag':'kneeling'}],
                                                       'phrases':['viewed from above']})
        value=ns['DanbooruVueSearchNode']().execute(json.dumps({'reverse_enabled':True,'selected_tags':[]}),character_tags='跪着')
        snapshot=json.loads(value['ui']['danbooru_output'][0])
        self.assertEqual(snapshot['tags'],'kneeling')
        self.assertEqual(snapshot['anima_prompt'],value['result'][3])
        self.assertIn('viewed from above',snapshot['anima_prompt'])
        self.assertIn('reverse_result',value['ui'])

    def test_annotation_ui_and_snapshot_can_be_returned_together(self):
        ns=namespace()
        value=ns['DanbooruVueSearchNode']().execute(json.dumps({'selected_tags':[],
            'selected_tag_enrichment_request':{'id':'one'}}))
        self.assertIn('selected_annotation_result',value['ui'])
        self.assertIn('danbooru_output',value['ui'])


if __name__=='__main__':unittest.main()
