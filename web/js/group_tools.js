/**
 * Eagle Suite - Group Manager
 * 根据节点在画布上的位置自动填入所属分组名称
 */
import { app } from "../../../scripts/app.js";

function findGroupName(node) {
  if (!app || !app.graph || !app.graph.groups) return "No Group";
  var groups = app.graph.groups;
  var nx = node.pos[0];
  var ny = node.pos[1];
  var nw = node.size[0];
  var nh = node.size[1];
  var cx = nx + nw / 2;
  var cy = ny + nh / 2;
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    var gx = g._pos[0];
    var gy = g._pos[1];
    var gw = g._size[0];
    var gh = g._size[1];
    if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
      return g.title || "Group";
    }
  }
  return "No Group";
}

function setGroupName(node, name) {
  try {
    var w = (node.widgets || []).find(function(x) { return x.name === "group_name"; });
    if (w) w.value = name || "No Group";
  } catch (e) {}
}

app.registerExtension({
  name: "EagleSuite.GroupManager",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleGroupManager") return;

    var hideWidgets = function(node) {
      if (!node.widgets || !node.widgets.length) return false;
      var found = false;
      for (var i = 0; i < node.widgets.length; i++) {
        var w = node.widgets[i];
        if (w.name !== "group_name") continue;
        w.type = "hidden";
        w.computeSize = function() { return [0, -4]; };
        w.hidden = true;
        w.draw = function() {};
        found = true;
      }
      if (found) node.setDirtyCanvas(true, true);
      return found;
    };

    var orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      if (orig) orig.apply(this, arguments);
      var node = this;
      setTimeout(function() {
        hideWidgets(node);
        var name = findGroupName(node);
        setGroupName(node, name);
      }, 300);
    };
  }
});
