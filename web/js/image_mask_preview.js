const ASPECTS = new Map([
  ["1:1", [1, 1]], ["4:3", [4, 3]], ["3:4", [3, 4]], ["16:9", [16, 9]],
  ["9:16", [9, 16]], ["3:2", [3, 2]], ["2:3", [2, 3]],
]);
const PREVIEW_EDGE = 1024;
const MAX_MASK_RADIUS = 4096;
const MAX_FRAME_SIDE = 16384;
const MAX_FRAME_PIXELS = 64_000_000;
const LIMIT_EDGE = "限制长边";
const ORIGINAL = "原图";
const MEGAPIXELS = "按百万像素";
const LEGACY_SCALE = "等比例缩放";
const LEGACY_EXACT = "指定尺寸";
const ALIGN_OFF = "关闭";
const ALIGN_CROP = "居中裁剪";
const ALIGN_EXPAND = "居中扩展";
const ALIGN_NEAREST = "nearest";
let colorContext;

function validSize(width, height) {
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0;
}

export function orientedSize(width, height, rotation = 0) {
  return rotation % 180 === 90 ? [height, width] : [width, height];
}

function rotatePoint(x, y, clockwise) {
  switch (clockwise) {
    case 90: return [1 - y, x];
    case 180: return [1 - x, 1 - y];
    case 270: return [y, 1 - x];
    default: return [x, y];
  }
}

export function orientedPoint(x, y, { rotation, flip_x, flip_y }) {
  const [horizontal, vertical] = rotatePoint(x, y, rotation);
  return [flip_x ? 1 - horizontal : horizontal, flip_y ? 1 - vertical : vertical];
}

export function sourcePoint(x, y, { rotation, flip_x, flip_y }) {
  return rotatePoint(flip_x ? 1 - x : x, flip_y ? 1 - y : y, (360 - rotation) % 360);
}

export function frameGeometry(width, height, settings) {
  const { ratio = "original", framing = "crop", zoom = 1, x = 0.5, y = 0.5 } = settings ?? {};
  if (!validSize(width, height)) throw new RangeError("原图宽高需要为正整数。");
  if ((ratio !== "original" && !ASPECTS.has(ratio)) || !["crop", "pad"].includes(framing)) {
    throw new RangeError("构图比例或裁剪补边方式无效。");
  }
  if (![zoom, x, y].every(Number.isFinite) || zoom < 0.25 || zoom > 4 || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new RangeError("构图缩放或位置超出范围。");
  }

  let outputWidth = width;
  let outputHeight = height;
  if (ratio !== "original") {
    const [p, q] = ASPECTS.get(ratio);
    const wide = width * q >= height * p;
    if (framing === "crop") {
      if (wide) outputWidth = Math.max(1, Math.floor(height * p / q));
      else outputHeight = Math.max(1, Math.floor(width * q / p));
    } else if (wide) {
      outputHeight = Math.ceil(width * q / p);
    } else {
      outputWidth = Math.ceil(height * p / q);
    }
  }

  const drawWidth = Math.max(1, Math.round(width * zoom));
  const drawHeight = Math.max(1, Math.round(height * zoom));
  const transformed = outputWidth !== width || outputHeight !== height || drawWidth !== width || drawHeight !== height;
  if (transformed && (Math.max(outputWidth, outputHeight) > MAX_FRAME_SIDE ||
      outputWidth * outputHeight > MAX_FRAME_PIXELS)) {
    throw new RangeError("编辑输出超出处理范围。请将画布限制在每边 16384 像素且总计 64 百万像素以内。");
  }
  return {
    width: outputWidth, height: outputHeight, drawWidth, drawHeight,
    left: Math.round((outputWidth - drawWidth) * x) || 0,
    top: Math.round((outputHeight - drawHeight) * y) || 0,
  };
}

function parseLegacyResize(serialized) {
  if (serialized == null || serialized === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new RangeError("旧版尺寸设置不是有效的 JSON。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RangeError("旧版尺寸设置需要使用 JSON 对象。");
  }
  const { mode, alignment = ALIGN_OFF, percent = 100, width = 0, height = 0 } = parsed;
  if (![LIMIT_EDGE, ORIGINAL, LEGACY_SCALE, LEGACY_EXACT].includes(mode) ||
      ![ALIGN_OFF, ALIGN_CROP, ALIGN_EXPAND].includes(alignment)) {
    throw new RangeError("旧版尺寸模式或对齐方式无效。");
  }
  if (!Number.isFinite(percent) || percent < 1 || percent > 400) {
    throw new RangeError("旧版缩放百分比无效。");
  }
  if (![width, height].every((side) => Number.isInteger(side) && side >= 0 && side <= MAX_FRAME_SIDE)) {
    throw new RangeError("旧版输出宽高无效。");
  }
  return { mode, alignment, percent, width, height };
}

function resizedSize(width, height, mode, longestEdge, megapixels, legacy) {
  let scale;
  switch (mode) {
    case ORIGINAL:
      return { width, height };
    case LIMIT_EDGE:
      scale = Math.min(1, longestEdge / Math.max(width, height));
      break;
    case MEGAPIXELS: {
      if (!Number.isFinite(megapixels) || megapixels < 0.01 || megapixels > 64) {
        throw new RangeError("百万像素需在 0.01 到 64 之间。");
      }
      const pixels = megapixels * 1_000_000;
      scale = Math.min(Math.sqrt(pixels / (width * height)), pixels / Math.max(width, height));
      break;
    }
    case LEGACY_SCALE:
      scale = (legacy?.percent ?? 100) / 100;
      break;
    case LEGACY_EXACT:
      if (legacy?.width && legacy?.height) return { width: legacy.width, height: legacy.height };
      if (legacy?.width) scale = legacy.width / width;
      else if (legacy?.height) scale = legacy.height / height;
      else return { width, height };
      break;
    default:
      throw new RangeError("尺寸模式无效。");
  }
  return { width: Math.max(1, Math.floor(width * scale + 0.5)), height: Math.max(1, Math.floor(height * scale + 0.5)) };
}

function alignedLength(length, alignment, multiple) {
  if (alignment === ALIGN_CROP) return Math.floor(length / multiple) * multiple || length;
  if (alignment === ALIGN_EXPAND) return Math.ceil(length / multiple) * multiple;
  if (alignment === ALIGN_NEAREST && length >= multiple) {
    return Math.floor((length + Math.floor((multiple - 1) / 2)) / multiple) * multiple;
  }
  return length;
}

export function outputSize(width, height, options) {
  let { mode = LIMIT_EDGE, longestEdge = 2048, megapixels = 1, multiple = 8, legacyResize = "" } = options ?? {};
  if (!validSize(width, height)) throw new RangeError("原图宽高需要为正整数。");
  const legacy = parseLegacyResize(legacyResize);
  if (legacy) mode = legacy.mode;
  let alignment = legacy?.alignment ?? (mode === MEGAPIXELS ? ALIGN_NEAREST : ALIGN_OFF);
  if (alignment !== ALIGN_OFF && (!Number.isInteger(multiple) || multiple < 1 || multiple > 256)) {
    throw new RangeError("对齐倍数需在 1 到 256 之间。");
  }
  if (mode === LIMIT_EDGE && !Number.isFinite(longestEdge)) throw new RangeError("最长边设置无效。");
  if (mode === LIMIT_EDGE && alignment === ALIGN_EXPAND) {
    // Reserve space for the legacy padding without letting it exceed the long-edge cap.
    const cap = Math.floor(longestEdge / multiple) * multiple;
    if (cap) longestEdge = cap;
    else alignment = ALIGN_OFF;
  }
  const size = resizedSize(width, height, mode, longestEdge, megapixels, legacy);
  return {
    width: alignedLength(size.width, alignment, multiple),
    height: alignedLength(size.height, alignment, multiple),
  };
}

export function sampleImageColor(baseImage, paint, x, y, background = "") {
  const width = baseImage?.naturalWidth ?? baseImage?.width;
  const height = baseImage?.naturalHeight ?? baseImage?.height;
  if (!validSize(width, height) || !Number.isFinite(x) || !Number.isFinite(y) ||
      x < 0 || x >= width || y < 0 || y >= height) return null;

  if (!colorContext) {
    const pixel = document.createElement("canvas");
    pixel.width = pixel.height = 1;
    colorContext = pixel.getContext("2d", { willReadFrequently: true });
  }
  if (!colorContext) return null;
  try {
    const pixelX = Math.floor(x);
    const pixelY = Math.floor(y);
    colorContext.clearRect(0, 0, 1, 1);
    if (background) {
      colorContext.fillStyle = background;
      colorContext.fillRect(0, 0, 1, 1);
    }
    colorContext.drawImage(baseImage, pixelX, pixelY, 1, 1, 0, 0, 1, 1);
    const paintWidth = paint?.naturalWidth ?? paint?.width;
    const paintHeight = paint?.naturalHeight ?? paint?.height;
    if (pixelX < paintWidth && pixelY < paintHeight) {
      colorContext.drawImage(paint, pixelX, pixelY, 1, 1, 0, 0, 1, 1);
    }
    const [r, g, b, alpha] = colorContext.getImageData(0, 0, 1, 1).data;
    return alpha ? `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}` : null;
  } catch {
    colorContext = null;
    return null;
  }
}

function filterLines(input, output, width, height, horizontal, filter, ...parameters) {
  const count = horizontal ? height : width;
  const length = horizontal ? width : height;
  const stride = horizontal ? 1 : width;
  const step = horizontal ? width : 1;
  for (let line = 0; line < count; line++) {
    filter(input, output, line * step, stride, length, ...parameters);
  }
}

function maximumLine(input, output, start, stride, length, radius, queue) {
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let center = 0; center < length; center++) {
    if (head < tail && queue[head] < center - radius) head++;
    const right = Math.min(center + radius, length - 1);
    while (next <= right) {
      const value = input[start + next * stride];
      while (head < tail && input[start + queue[tail - 1] * stride] <= value) tail--;
      queue[tail++] = next++;
    }
    output[start + center * stride] = input[start + queue[head] * stride];
  }
}

function gaussianBox(sigma) {
  // Three weighted boxes per axis approximate Pillow's GaussianBlur at the same variance.
  const variance = sigma * sigma;
  const radius = Math.floor((Math.sqrt(4 * variance + 1) - 1) / 2);
  const diameter = 2 * radius + 1;
  const outer = radius + 1;
  const edge = diameter * (variance - radius * outer) / (2 * (3 * outer * outer - variance));
  return { radius, edge, scale: 1 / (diameter + 2 * edge) };
}

function blurLine(input, output, start, stride, length, box) {
  const { radius, edge, scale } = box;
  const last = length - 1;
  let sum = input[start] * (radius + 1);
  for (let index = 1; index <= Math.min(last, radius); index++) sum += input[start + index * stride];
  sum += input[start + last * stride] * Math.max(0, radius - last);
  for (let center = 0; center < length; center++) {
    const left = Math.max(0, center - radius - 1);
    const right = Math.min(last, center + radius + 1);
    const rightValue = input[start + right * stride];
    output[start + center * stride] = (sum + edge * (input[start + left * stride] + rightValue)) * scale;
    sum += rightValue - input[start + Math.max(0, center - radius) * stride];
  }
}

function maskRadius(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_MASK_RADIUS, value)) : 0;
}

function previewAlpha(pixels, width, height, sourceWidth, sourceHeight, settings) {
  let alpha = new Uint8Array(width * height);
  let highest = 0;
  let lowest = 255;
  for (let pixel = 0; pixel < alpha.length; pixel++) {
    const value = pixels[pixel * 4 + 3];
    alpha[pixel] = value;
    highest = Math.max(highest, value);
    lowest = Math.min(lowest, value);
  }
  if (!highest) return null;
  if (highest === lowest) return alpha;

  const scaleX = width / sourceWidth;
  const scaleY = height / sourceHeight;
  const grow = settings?.grow === true ? Math.round(maskRadius(settings.expand ?? 16)) : 0;
  const growX = Math.min(width - 1, Math.round(grow * scaleX));
  const growY = Math.min(height - 1, Math.round(grow * scaleY));
  if (growX || growY) {
    const scratch = new Uint8Array(alpha.length);
    const queue = new Int32Array(Math.max(width, height));
    filterLines(alpha, scratch, width, height, true, maximumLine, growX, queue);
    filterLines(scratch, alpha, width, height, false, maximumLine, growY, queue);
  }
  const feather = maskRadius(settings?.feather);
  if (feather > 0) {
    alpha = Float32Array.from(alpha);
    const scratch = new Float32Array(alpha.length);
    const boxX = gaussianBox(feather * scaleX);
    const boxY = gaussianBox(feather * scaleY);
    for (let pass = 0; pass < 3; pass++) {
      filterLines(alpha, scratch, width, height, true, blurLine, boxX);
      filterLines(scratch, alpha, width, height, false, blurLine, boxY);
    }
  }
  return alpha;
}

export function renderMaskPreview(source, target, sourceWidth, sourceHeight, settings) {
  if (!target || source === target) return false;
  if (!source || !validSize(sourceWidth, sourceHeight)) {
    target.width = target.height = 0;
    return false;
  }
  const scale = Math.min(1, PREVIEW_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;
  const context = target.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  let image;
  try {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "copy";
    context.filter = "none";
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);
    context.restore();
    image = context.getImageData(0, 0, width, height);
  } catch {
    target.width = target.height = 0;
    return false;
  }

  const alpha = previewAlpha(image.data, width, height, sourceWidth, sourceHeight, settings);
  if (!alpha) return false;
  let visible = false;
  for (let index = 0; index < alpha.length; index++) {
    const offset = index * 4;
    image.data[offset] = 239;
    image.data[offset + 1] = 72;
    image.data[offset + 2] = 111;
    image.data[offset + 3] = alpha[index];
    visible ||= image.data[offset + 3] > 0;
  }
  context.putImageData(image, 0, 0);
  return visible;
}
