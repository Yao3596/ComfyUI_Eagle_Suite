"""Pure Python coverage for the image editor's runtime geometry and mask effects."""

from dataclasses import fields
import importlib.util
import json
from pathlib import Path
import sys
import unittest

from PIL import Image, ImageFilter


MODULE = Path(__file__).resolve().parents[1] / "eagle_suite" / "image_editor_geometry.py"
SPEC = importlib.util.spec_from_file_location("eagle_test_image_editor_geometry", MODULE)
geometry = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = geometry
SPEC.loader.exec_module(geometry)


def settings(**values):
    return geometry.parse_adjustments(json.dumps(values))


class EditorGeometryTests(unittest.TestCase):
    def test_legacy_defaults_preserve_original_layer_objects(self):
        for value in (None, "", "  ", "{}"):
            with self.subTest(value=value):
                defaults = geometry.parse_adjustments(value)
                self.assertEqual(
                    {item.name: getattr(defaults, item.name) for item in fields(defaults)},
                    {"grow": False, "expand": 16, "feather": 0, "ratio": "original", "framing": "crop",
                     "zoom": 1, "x": .5, "y": .5, "fill": "#ffffff", "mask_fill": True,
                     "rotation": 0, "flip_x": False, "flip_y": False},
                )
                rgb = Image.new("RGB", (5, 9), "red")
                mask = Image.new("L", rgb.size, 89)
                self.assertIs(geometry.apply_mask_adjustments(mask, defaults), mask)
                result_rgb, result_mask = geometry.frame_layers(rgb, mask, defaults)
                self.assertIs(result_rgb, rgb)
                self.assertIs(result_mask, mask)

    def test_malformed_or_out_of_range_values_fail_validation(self):
        for value in ("{", "[]", "null", '{"grow":1}', '{"mask_fill":"true"}', '{"zoom":0.24}',
                      '{"zoom":4.5}', '{"x":-0.1}', '{"y":NaN}', '{"ratio":"2:1"}', '{"framing":"stretch"}',
                      '{"expand":-1}', '{"feather":4097}', '{"fill":"red"}', '{"rotation":45}',
                      '{"rotation":true}', '{"rotation":"90"}', '{"flip_x":1}', '{"flip_y":null}'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                geometry.parse_adjustments(value)
        valid = settings(expand=3.5, feather=2.25, fill="#ABC123", extra_future_field=True)
        self.assertEqual((4, 2.25, "#abc123"), (valid.expand, valid.feather, valid.fill))

    def test_orientation_rotates_clockwise_then_flips_in_the_output_axes(self):
        source = Image.frombytes("L", (3, 2), bytes([10, 20, 30, 40, 50, 60]))
        for options, size, pixels in (
            ({"rotation": 90}, (2, 3), [40, 10, 50, 20, 60, 30]),
            ({"rotation": 180}, (3, 2), [60, 50, 40, 30, 20, 10]),
            ({"rotation": 270.0}, (2, 3), [30, 60, 20, 50, 10, 40]),
            ({"flip_x": True}, (3, 2), [30, 20, 10, 60, 50, 40]),
            ({"flip_y": True}, (3, 2), [40, 50, 60, 10, 20, 30]),
            ({"rotation": 90, "flip_x": True}, (2, 3), [10, 40, 20, 50, 30, 60]),
            ({"rotation": 90, "flip_y": True}, (2, 3), [60, 30, 50, 20, 40, 10]),
        ):
            with self.subTest(options=options):
                result = geometry.orient_image(source, settings(**options))
                self.assertEqual(size, result.size)
                self.assertEqual(bytes(pixels), result.tobytes())
        self.assertIs(source, geometry.orient_image(source, settings()))
        self.assertIs(source, geometry.orient_image(source, settings(rotation=180, flip_x=True, flip_y=True)))
        self.assertEqual(bytes([10, 20, 30, 40, 50, 60]), source.tobytes())

    def test_aspect_presets_keep_largest_crop_and_smallest_pad(self):
        for source, ratio, crop, pad in (
            ((17, 23), "1:1", (17, 17), (23, 23)),
            ((1001, 700), "4:3", (933, 700), (1001, 751)),
            ((700, 1001), "3:4", (700, 933), (751, 1001)),
            ((1001, 700), "16:9", (1001, 563), (1245, 700)),
            ((700, 1001), "9:16", (563, 1001), (700, 1245)),
            ((7, 5), "3:2", (7, 4), (8, 5)),
            ((5, 7), "2:3", (4, 7), (5, 8)),
            ((1, 1), "16:9", (1, 1), (2, 1)),
        ):
            with self.subTest(source=source, ratio=ratio):
                self.assertEqual(crop, geometry.frame_geometry(source, settings(ratio=ratio))[0])
                self.assertEqual(pad, geometry.frame_geometry(source, settings(ratio=ratio, framing="pad"))[0])

    def test_rounds_zoom_and_placement_like_math_round(self):
        self.assertEqual(((7, 4), (7, 5), 0, 0), geometry.frame_geometry((7, 5), settings(ratio="3:2")))
        options = settings(ratio="1:1", framing="pad", zoom=1.5)
        self.assertEqual(((5, 5), (8, 5), -1, 0), geometry.frame_geometry((5, 3), options))
        self.assertEqual(((5, 3), (3, 2), 2, 1),
                         geometry.frame_geometry((5, 3), settings(zoom=.5, x=.75, y=.5)))

    def test_moving_crop_applies_the_same_coordinates_to_rgb_and_mask(self):
        rgb = Image.new("RGB", (7, 5))
        mask = Image.new("L", rgb.size)
        for y in range(rgb.height):
            for x in range(rgb.width):
                rgb.putpixel((x, y), (20 * x, 30 * y, 56))
                mask.putpixel((x, y), 10 * x + y)
        cropped_rgb, cropped_mask = geometry.frame_layers(rgb, mask, settings(ratio="1:1", x=1))
        self.assertEqual(rgb.crop((2, 0, 7, 5)).tobytes(), cropped_rgb.tobytes())
        self.assertEqual(mask.crop((2, 0, 7, 5)).tobytes(), cropped_mask.tobytes())

    def test_exposed_padding_receives_selected_rgb_and_optional_mask(self):
        rgb = Image.new("RGB", (5, 3), (200, 100, 50))
        mask = Image.new("L", rgb.size, 69)
        for mask_fill in (True, False):
            with self.subTest(mask_fill=mask_fill):
                options = settings(ratio="1:1", framing="pad", y=1, fill="#123456", mask_fill=mask_fill)
                result_rgb, result_mask = geometry.frame_layers(rgb, mask, options)
                self.assertEqual((5, 5), result_rgb.size)
                self.assertEqual(result_rgb.size, result_mask.size)
                self.assertEqual((18, 52, 86), result_rgb.getpixel((0, 1)))
                self.assertEqual(255 if mask_fill else 0, result_mask.getpixel((0, 1)))
                self.assertEqual((200, 100, 50), result_rgb.getpixel((4, 2)))
                self.assertEqual(69, result_mask.getpixel((4, 2)))

    def test_zoomed_out_crop_can_expose_fill_outside_the_subject(self):
        rgb = Image.new("RGB", (5, 3), (10, 20, 30))
        mask = Image.new("L", rgb.size, 120)
        options = settings(ratio="1:1", zoom=.5, fill="#112233", mask_fill=False)
        result_rgb, result_mask = geometry.frame_layers(rgb, mask, options)
        self.assertEqual((3, 3), result_rgb.size)
        self.assertEqual((17, 34, 51), result_rgb.getpixel((0, 0)))
        self.assertEqual((10, 20, 30), result_rgb.getpixel((0, 1)))
        self.assertEqual((0, 120), (result_mask.getpixel((0, 0)), result_mask.getpixel((0, 1))))

    def test_limits_extreme_new_frames_but_leaves_legacy_identity_unchanged(self):
        with self.assertRaises(ValueError):
            geometry.frame_geometry((4096, 11000), settings(ratio="16:9", framing="pad"))
        with self.assertRaises(ValueError):
            geometry.frame_geometry((9000, 9000), settings(zoom=2))
        self.assertEqual(((20000, 7000), (20000, 7000), 0, 0),
                         geometry.frame_geometry((20000, 7000), settings()))
        self.assertEqual(((3840, 2160), (15360, 8640), -5760, -3240),
                         geometry.frame_geometry((3840, 2160), settings(zoom=4)))


class MaskAdjustmentTests(unittest.TestCase):
    def test_growth_uses_source_pixel_radius_and_preserves_soft_alpha(self):
        source = Image.new("L", (7, 5))
        points = [(1, 1, 68), (4, 1, 201), (6, 4, 110)]
        for x, y, value in points:
            source.putpixel((x, y), value)
        original = source.tobytes()
        self.assertIs(source, geometry.apply_mask_adjustments(source, settings(expand=2)))
        expanded = geometry.apply_mask_adjustments(source, settings(grow=True, expand=2))
        expected = bytes(max([v for sx, sy, v in points if abs(x - sx) <= 2 and abs(y - sy) <= 2] + [0])
                         for y in range(source.height) for x in range(source.width))
        self.assertEqual(expected, expanded.tobytes())
        self.assertEqual(original, source.tobytes())

    def test_feather_is_independent_and_runs_after_expansion(self):
        source = Image.new("L", (31, 31))
        source.putpixel((15, 15), 255)
        feathered = geometry.apply_mask_adjustments(source, settings(feather=2))
        self.assertEqual(source.filter(ImageFilter.GaussianBlur(2)).tobytes(), feathered.tobytes())

        combined = geometry.apply_mask_adjustments(source, settings(grow=True, expand=3, feather=2))
        expected = source.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(2))
        self.assertEqual(expected.tobytes(), combined.tobytes())
        self.assertGreater(combined.getpixel((19, 15)), 0)
        self.assertLess(combined.getpixel((19, 15)), 255)

    def test_uniform_mask_has_no_effect_even_with_both_controls_active(self):
        source = Image.new("L", (3, 3), 81)
        self.assertIs(source, geometry.apply_mask_adjustments(source, settings(grow=True, feather=2.5)))


if __name__ == "__main__":
    unittest.main()
