#!/usr/bin/env python3
"""Apply the exact H3 size/time contract to the bundled Director Skills."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path


SIZE_SECTION = """##### H3 标准尺寸表
- 16:9 只使用以下 32 倍数尺寸：`0.2=608×352` / `0.3=736×416` / `0.4=864×480` / `0.5=960×544` / `0.6=1056×608` / `0.7=1152×640` / `0.8=1216×672` / `0.9=1280×736` / `0.98=1344×768` / `1.0=1376×768` / `1.2=1504×832` / `1.5=1664×928` / `1.8=1824×1024` / `2.0=1920×1088`。
- 9:16 使用同档尺寸的宽高转置。自定义宽高必须对齐 32；锁链开启时修改一边必须等比重算另一边。
- UI 标注档位与 MP 仅用于选择；编译后的 `width×height` 才是执行真值。"""

TIME_SECTION = """##### H3 精确时间合同
- `timeline_duration_seconds` / `timeline_frames` 是剪辑交付的唯一权威；每镜元数据写为 `Time range: MM:SS.mmm --> MM:SS.mmm | frames [start,end) @ 24fps | Duration: X.XXX s`。
- H3 执行帧长必须向上对齐 `17k+5`。`raw_frames` / `generated_duration_seconds` 只表示模型实际生成量，不得反向改写剪辑时码。
- 续镜时 `raw_frames` 还需包含头部上下文帧。生成后先裁头部上下文，再用 `target_frames` 裁掉网格尾帧，保证交付时长精确。
- `[Shot 1]` 执行提示不写切镜时间；后续镜头用 `At MM:SS.mmm, the camera cuts to ...`，且必须严格递增并落在场景范围内。"""

STYLE_SECTION = """##### 表现风格
- `auto`：根据主体参考的二维/三维/真人特征自动选择，无法可靠判断时保持原素材风格，不擅自写真化或动漫化。
- `live_action`：使用真实人体重量、惯性、关节活动范围、肌肉牵引、呼吸和微表情；避免动漫式夸张停顿、速度线和不符合物理的弹性形变。
- `anime`：严格保留 2D/cel/anime 造型语言，使用清晰关键姿势、短暂停顿、预备动作、跟随动作与可控夸张；避免皮肤写真化、写实毛孔和 3D 渲染漂移。
- 表现风格只改变动作和画面语言，不改变角色身份、服装、成人尺度、时长或循环策略。"""


def append_once(content: str, marker: str, section: str) -> str:
    return content if marker in content else content.rstrip() + "\n\n" + section + "\n"


def main(path_text: str):
    path = Path(path_text)
    data = json.loads(path.read_text(encoding="utf-8"))
    stamp = datetime.now().isoformat()

    rhythm = data.get("pro-v1-rhythm")
    if rhythm:
        rhythm["content"] = append_once(
            rhythm.get("content", ""), "H3 精确时间合同", TIME_SECTION
        )
        rhythm["updated_at"] = stamp

    character = data.get("pro-v1-h3-character-dynamic-director")
    if character:
        content = character.get("content", "")
        content = append_once(content, "H3 标准尺寸表", SIZE_SECTION)
        content = append_once(content, "H3 精确时间合同", TIME_SECTION)
        content = content.replace(
            "- 单片段 4–15 秒、24fps；本地精确帧长使用 `17k+5` 网格。",
            "- 单片段 4–15 秒、24fps；剪辑交付帧按时长精确换算，H3 执行帧单独向上对齐 `17k+5` 网格。",
        )
        character["content"] = content
        character["updated_at"] = stamp

    interaction = data.get("pro-v2-h3-character-interaction-automation")
    if interaction:
        interaction["content"] = append_once(
            interaction.get("content", ""), "##### 表现风格", STYLE_SECTION
        )
        interaction["updated_at"] = stamp

    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"updated={path} skills={len(data)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: update_h3_director_skills.py PATH")
    main(sys.argv[1])
