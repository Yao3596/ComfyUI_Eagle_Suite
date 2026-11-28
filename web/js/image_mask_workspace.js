const STYLE_ID = "eagle-image-workspace-dialog-style";

function installStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .eime-dialog {
      box-sizing: border-box;
      width: min(1520px, calc(100vw - 40px));
      height: min(1040px, calc(100vh - 40px));
      height: min(1040px, calc(100dvh - 40px));
      max-width: none;
      max-height: none;
      margin: auto;
      padding: 0;
      overflow: hidden;
      border: 1px solid #44536b;
      border-radius: 12px;
      background: #141923;
      color: #dce6f5;
      box-shadow: 0 18px 70px #0009;
      font: 13px/1.5 system-ui, sans-serif;
    }
    .eime-dialog[open] { display: flex; flex-direction: column; }
    .eime-dialog::backdrop { background: #090c14bf; }
    .eime-dialog__header {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 44px;
      padding: 6px 12px;
      border-bottom: 1px solid #394457;
      background: #1b2431;
    }
    .eime-dialog__header h2 { margin: 0; font-size: 15px; font-weight: 600; }
    .eime-dialog__header button {
      min-height: 30px;
      padding: 4px 12px;
      border: 1px solid #44536b;
      border-radius: 5px;
      background: #212b3c;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .eime-dialog__header button:hover,
    .eime-dialog__header button:focus-visible { border-color: #87addf; }
    .eime-dialog > .eime-dialog__host {
      flex: 1 1 0;
      height: auto;
      min-height: 0;
      min-width: 0;
      padding: 10px;
      overflow: auto;
      border: 0;
      border-radius: 0;
    }
    .eime-dialog__host > :first-child {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 7px;
      min-height: 0;
      min-width: 0;
    }
  `;
  doc.head.append(style);
}

export function createWorkspaceDialog(view, panel, onLayout) {
  const doc = panel.ownerDocument;
  const win = doc.defaultView;
  const dialog = doc.createElement("dialog");
  dialog.className = "eime-dialog";
  const header = doc.createElement("header");
  header.className = "eime-dialog__header";
  const title = doc.createElement("h2");
  title.textContent = "图像与遮罩编辑器";
  dialog.setAttribute("aria-label", title.textContent);
  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "关闭";
  closeButton.setAttribute("aria-label", "关闭大画布");
  header.append(title, closeButton);
  const host = doc.createElement("div");
  host.className = "eime-root eime-dialog__host";
  dialog.append(header, host);

  const marker = doc.createComment("image editor workspace");
  let opener = null;
  let layoutFrame = 0;
  let disposed = false;

  function layout() {
    win.cancelAnimationFrame(layoutFrame);
    layoutFrame = win.requestAnimationFrame(() => {
      layoutFrame = 0;
      onLayout?.();
    });
  }

  function restorePanel(restoreFocus) {
    if (panel.parentNode !== host) return;
    if (marker.parentNode) marker.replaceWith(panel);
    else view.root.append(panel);
    dialog.remove();
    const trigger = opener;
    opener = null;
    if (disposed) return;
    if (restoreFocus && trigger?.isConnected) trigger.focus?.({ preventScroll: true });
    layout();
  }

  function close() {
    if (dialog.open) dialog.close();
    restorePanel(true);
  }

  closeButton.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("close", () => {
    if (!dialog.open) restorePanel(true);
  });

  return {
    open(trigger) {
      if (disposed || dialog.open || !view.root?.contains(panel)) return false;
      installStyles(doc);
      opener = trigger ?? doc.activeElement;
      panel.before(marker);
      host.append(panel);
      doc.body.append(dialog);
      try {
        dialog.showModal();
      } catch (error) {
        restorePanel(true);
        throw error;
      }
      layout();
      return true;
    },
    close,
    dispose() {
      if (disposed) return;
      disposed = true;
      win.cancelAnimationFrame(layoutFrame);
      if (dialog.open) dialog.close();
      restorePanel(false);
      dialog.remove();
    },
    contains(target) {
      return target instanceof win.Node && dialog.contains(target);
    },
    get active() {
      return dialog.open;
    },
  };
}
