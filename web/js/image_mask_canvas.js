const TILE_SIZE = 256;
const MAX_HISTORY_BYTES = 96 * 1024 * 1024;
const MAX_HISTORY_STEPS = 24;
const MASK_COLOR = "#ef486f";

function* tiles(width, height, area = { x: 0, y: 0, width, height }) {
  const left = Math.floor(Math.max(0, area.x) / TILE_SIZE) * TILE_SIZE;
  const top = Math.floor(Math.max(0, area.y) / TILE_SIZE) * TILE_SIZE;
  const right = Math.min(width, area.x + area.width);
  const bottom = Math.min(height, area.y + area.height);
  for (let y = top; y < bottom; y += TILE_SIZE) {
    for (let x = left; x < right; x += TILE_SIZE) {
      yield { x, y, width: Math.min(TILE_SIZE, width - x), height: Math.min(TILE_SIZE, height - y) };
    }
  }
}

function brushTip(size, hardness, color, shape) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.ceil(size);
  const radius = canvas.width / 2;
  const context = canvas.getContext("2d");
  if (shape === "square") {
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (hardness < 1) {
      const edge = (1 - hardness) / 2;
      context.globalCompositeOperation = "destination-in";
      for (const [x, y] of [[canvas.width, 0], [0, canvas.height]]) {
        const gradient = context.createLinearGradient(0, 0, x, y);
        gradient.addColorStop(0, "transparent");
        gradient.addColorStop(edge, "white");
        gradient.addColorStop(1 - edge, "white");
        gradient.addColorStop(1, "transparent");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    return canvas;
  }
  let fill = color;
  if (hardness < 1) {
    fill = context.createRadialGradient(radius, radius, radius * hardness, radius, radius, radius);
    fill.addColorStop(0, color);
    fill.addColorStop(1, `${color}00`);
  }
  context.fillStyle = fill;
  context.beginPath();
  context.arc(radius, radius, radius, 0, Math.PI * 2);
  context.fill();
  return canvas;
}

function setMaskPixel(pixels, index, alpha) {
  pixels[index] = 239;
  pixels[index + 1] = 72;
  pixels[index + 2] = 111;
  pixels[index + 3] = alpha;
}

function invertAlpha(imageData) {
  const pixels = imageData.data;
  for (let index = 0; index < pixels.length; index += 4) {
    setMaskPixel(pixels, index, 255 - pixels[index + 3]);
  }
}

function coverage(imageData) {
  for (let index = 3; index < imageData.data.length; index += 4) {
    if (imageData.data[index]) return true;
  }
  return false;
}

function readAlpha(width, height, readTile) {
  const alpha = new Uint8Array(width * height);
  const bounds = { left: width, top: height, right: 0, bottom: 0 };
  for (const { x, y, width: tileWidth, height: tileHeight } of tiles(width, height)) {
    const rgba = readTile(x, y, tileWidth, tileHeight).data;
    let channel = 3;
    let occupied = 0;
    for (let row = y; row < y + tileHeight; row++) {
      const start = row * width + x;
      const end = start + tileWidth;
      for (let pixel = start; pixel < end; pixel++) {
        const value = rgba[channel];
        alpha[pixel] = value;
        occupied |= value;
        channel += 4;
      }
    }
    if (occupied) {
      bounds.left = Math.min(bounds.left, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.right = Math.max(bounds.right, x + tileWidth);
      bounds.bottom = Math.max(bounds.bottom, y + tileHeight);
    }
  }
  return { alpha, bounds };
}

function maxLine(source, output, start, stride, length, radius, queue) {
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let center = 0; center < length; center++) {
    if (head < tail && queue[head] < center - radius) head++;
    const right = Math.min(length - 1, center + radius);
    while (next <= right) {
      const value = source[start + next * stride];
      // Keep only samples that can still be the maximum of a future window.
      while (head < tail && source[start + queue[tail - 1] * stride] <= value) tail--;
      queue[tail++] = next++;
    }
    output[start + center * stride] = source[start + queue[head] * stride];
  }
}

export class ImageEditorSurface {
  constructor(canvases, baseImage, savedLayers) {
    this.canvases = canvases;
    this.width = baseImage.naturalWidth;
    this.height = baseImage.naturalHeight;
    this.contexts = {};
    this.undoStack = [];
    this.redoStack = [];
    this.dirtyLayers = new Set();
    this.stroke = null;
    for (const [layer, canvas] of Object.entries(canvases)) {
      canvas.width = this.width;
      canvas.height = this.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      this.contexts[layer] = context;
      if (savedLayers[layer]) context.drawImage(savedLayers[layer], 0, 0);
    }
    if (!savedLayers.mask) this.restoreSourceMask(baseImage);
  }

  restoreSourceMask(baseImage) {
    const mask = this.contexts.mask;
    mask.clearRect(0, 0, this.width, this.height);
    mask.drawImage(baseImage, 0, 0);
    for (const { x, y, width, height } of tiles(this.width, this.height)) {
      const data = mask.getImageData(x, y, width, height);
      invertAlpha(data);
      mask.putImageData(data, x, y);
    }
  }

  transaction(layer) {
    return { layer, tiles: new Map(), bytes: 0, tooLarge: false };
  }

  remember(action, tile, snapshot) {
    const key = `${tile.x},${tile.y}`;
    if (action.tooLarge || action.tiles.has(key)) return;
    action.bytes += tile.width * tile.height * 4;
    if (action.bytes > MAX_HISTORY_BYTES) {
      action.tiles.clear();
      action.tooLarge = true;
      return;
    }
    const { x, y, width, height } = tile;
    const pixels = snapshot ?? this.contexts[action.layer].getImageData(x, y, width, height);
    action.tiles.set(key, { x, y, pixels });
  }

  commit(action) {
    if (!action.tiles.size && !action.tooLarge) return false;
    this.dirtyLayers.add(action.layer);
    if (action.tooLarge) {
      this.undoStack.length = 0;
      this.redoStack.length = 0;
      return true;
    }
    this.pushHistory(action);
    return true;
  }

  pushHistory(action) {
    this.redoStack.length = 0;
    this.undoStack.push(action);
    let bytes = this.undoStack.reduce((sum, step) => sum + step.bytes, 0);
    while (this.undoStack.length > MAX_HISTORY_STEPS || bytes > MAX_HISTORY_BYTES) {
      bytes -= this.undoStack.shift().bytes;
    }
  }

  recordChange(undo, redo, bytes = 0) {
    this.pushHistory({ undo, redo, bytes });
  }

  swapTiles(action) {
    const context = this.contexts[action.layer];
    for (const tile of action.tiles.values()) {
      const { x, y, pixels } = tile;
      tile.pixels = context.getImageData(x, y, pixels.width, pixels.height);
      context.putImageData(pixels, x, y);
    }
    this.dirtyLayers.add(action.layer);
  }

  swap(from, to, direction) {
    const action = from.pop();
    if (!action) return;
    if (action[direction]) action[direction]();
    else this.swapTiles(action);
    to.push(action);
  }

  undo() { this.swap(this.undoStack, this.redoStack, "undo"); }
  redo() { this.swap(this.redoStack, this.undoStack, "redo"); }

  resetToSource(baseImage, undoSettings, redoSettings) {
    const scratch = document.createElement("canvas");
    scratch.width = scratch.height = TILE_SIZE;
    const source = scratch.getContext("2d", { willReadFrequently: true });
    const paint = this.transaction("paint");
    const mask = this.transaction("mask");
    let bytes = 0;
    for (const tile of tiles(this.width, this.height)) {
      const { x, y, width, height } = tile;
      const painted = this.contexts.paint.getImageData(x, y, width, height);
      if (coverage(painted)) {
        bytes += painted.data.byteLength;
        if (bytes > MAX_HISTORY_BYTES) return false;
        this.remember(paint, tile, painted);
      }

      const edited = this.contexts.mask.getImageData(x, y, width, height);
      source.clearRect(0, 0, width, height);
      source.drawImage(baseImage, x, y, width, height, 0, 0, width, height);
      const original = source.getImageData(0, 0, width, height);
      for (let index = 3; index < edited.data.length; index += 4) {
        if (edited.data[index] === 255 - original.data[index]) continue;
        bytes += edited.data.byteLength;
        if (bytes > MAX_HISTORY_BYTES) return false;
        this.remember(mask, tile, edited);
        break;
      }
    }

    const changed = [paint, mask].filter((action) => action.tiles.size);
    if (paint.tiles.size) this.contexts.paint.clearRect(0, 0, this.width, this.height);
    if (mask.tiles.size) this.restoreSourceMask(baseImage);
    const swapLayers = () => {
      for (const action of changed) this.swapTiles(action);
    };
    for (const action of changed) this.dirtyLayers.add(action.layer);
    this.recordChange(() => { swapLayers(); undoSettings(); }, () => { swapLayers(); redoSettings(); }, bytes);
    redoSettings();
    return true;
  }

  beginStroke(layer, settings, point) {
    this.stroke = {
      action: this.transaction(layer),
      tip: brushTip(settings.size, settings.hardness, layer === "mask" ? MASK_COLOR : settings.color, settings.shape),
      flow: settings.flow, erase: settings.erase,
      last: point,
    };
    this.moveStroke(point);
  }

  moveStroke(point) {
    const stroke = this.stroke;
    if (!stroke) return;
    const { action, tip, last } = stroke;
    const context = this.contexts[action.layer];
    const size = tip.width;
    const radius = size / 2;
    const distance = Math.hypot(point.x - last.x, point.y - last.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, size * 0.18)));
    context.save();
    context.globalAlpha = stroke.flow;
    context.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
    for (let step = 1; step <= steps; step++) {
      const x = last.x + (point.x - last.x) * step / steps - radius;
      const y = last.y + (point.y - last.y) * step / steps - radius;
      for (const tile of tiles(this.width, this.height, { x, y, width: size + 1, height: size + 1 })) {
        this.remember(action, tile);
      }
      context.drawImage(tip, x, y);
    }
    context.restore();
    stroke.last = point;
  }

  endStroke() {
    if (!this.stroke) return;
    this.commit(this.stroke.action);
    this.stroke = null;
  }

  clear(layer) {
    const action = this.transaction(layer);
    for (const tile of tiles(this.width, this.height)) this.remember(action, tile);
    this.contexts[layer].clearRect(0, 0, this.width, this.height);
    this.commit(action);
  }

  invertMask() {
    const action = this.transaction("mask");
    const context = this.contexts.mask;
    for (const tile of tiles(this.width, this.height)) {
      this.remember(action, tile);
      const { x, y, width, height } = tile;
      const pixels = context.getImageData(x, y, width, height);
      invertAlpha(pixels);
      context.putImageData(pixels, x, y);
    }
    this.commit(action);
  }

  applyMaskAlpha(alpha, area) {
    const action = this.transaction("mask");
    const context = this.contexts.mask;
    for (const tile of tiles(this.width, this.height, area)) {
      const { x, y, width, height } = tile;
      const before = context.getImageData(x, y, width, height);
      let after;
      let offset = 0;
      for (let row = y; row < y + height; row++) {
        const start = row * this.width + x;
        const end = start + width;
        for (let pixel = start; pixel < end; pixel++, offset += 4) {
          if (before.data[offset + 3] === alpha[pixel]) continue;
          after ??= before.data.slice();
          setMaskPixel(after, offset, alpha[pixel]);
        }
      }
      if (!after) continue;
      this.remember(action, tile, before);
      context.putImageData(new ImageData(after, width, height), x, y);
    }
    return this.commit(action);
  }

  growMask(radius) {
    const distance = Math.round(radius);
    if (!Number.isFinite(distance) || distance <= 0) return false;
    const { width, height } = this;
    const context = this.contexts.mask;
    const { alpha, bounds } = readAlpha(width, height, (x, y, w, h) => context.getImageData(x, y, w, h));
    if (!bounds.right) return false;
    const full = bounds.left === 0 && bounds.top === 0 && bounds.right === width && bounds.bottom === height;
    if (full && !alpha.some((value) => value !== alpha[0])) return false;

    const left = Math.max(0, bounds.left - distance);
    const top = Math.max(0, bounds.top - distance);
    const right = Math.min(width, bounds.right + distance);
    const bottom = Math.min(height, bounds.bottom + distance);
    const area = { x: left, y: top, width: right - left, height: bottom - top };

    const scratch = new Uint8Array(alpha.length);
    const queue = new Int32Array(Math.max(area.width, area.height));
    const horizontal = Math.min(distance, area.width - 1);
    const vertical = Math.min(distance, area.height - 1);
    for (let y = top; y < bottom; y++) {
      maxLine(alpha, scratch, y * width + left, 1, area.width, horizontal, queue);
    }
    for (let x = left; x < right; x++) {
      maxLine(scratch, alpha, top * width + x, width, area.height, vertical, queue);
    }
    return this.applyMaskAlpha(alpha, area);
  }

  replaceMask(image) {
    if ((image?.naturalWidth ?? image?.width) !== this.width ||
        (image?.naturalHeight ?? image?.height) !== this.height) {
      throw new RangeError("分割遮罩与原图尺寸不一致");
    }
    const buffer = document.createElement("canvas");
    buffer.width = buffer.height = TILE_SIZE;
    const context = buffer.getContext("2d", { willReadFrequently: true });
    const { alpha } = readAlpha(this.width, this.height, (x, y, width, height) => {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, x, y, width, height, 0, 0, width, height);
      return context.getImageData(0, 0, width, height);
    });
    return this.applyMaskAlpha(alpha);
  }

  fill(layer, color) {
    const action = this.transaction(layer);
    const context = this.contexts[layer];
    if (layer === "mask") {
      for (const tile of tiles(this.width, this.height)) this.remember(action, tile);
      context.fillStyle = MASK_COLOR;
      context.fillRect(0, 0, this.width, this.height);
      return this.commit(action);
    }

    const buffer = document.createElement("canvas");
    buffer.width = buffer.height = TILE_SIZE;
    const scratch = buffer.getContext("2d");
    const mask = this.contexts.mask;
    for (const tile of tiles(this.width, this.height)) {
      const { x, y, width, height } = tile;
      const pixels = mask.getImageData(x, y, width, height);
      if (!coverage(pixels)) continue;
      this.remember(action, tile);
      scratch.putImageData(pixels, 0, 0);
      scratch.globalCompositeOperation = "source-in";
      scratch.fillStyle = color;
      scratch.fillRect(0, 0, width, height);
      context.drawImage(buffer, 0, 0, width, height, x, y, width, height);
    }
    return this.commit(action);
  }

  dispose() {
    for (const canvas of Object.values(this.canvases)) canvas.width = canvas.height = 0;
    this.undoStack.length = this.redoStack.length = 0;
    this.stroke = null;
  }
}
