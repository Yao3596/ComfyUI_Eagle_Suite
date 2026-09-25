// Workflow JSON is exportable and shareable. Keep runtime credentials on the
// widget, but remove them from both workflow serialization formats.
export function redactSecretWidgetFromWorkflow(data, node, widget) {
  if (!data || !widget) return data;

  const redacted = { ...data };
  const named = data.widgets_values_named;
  if (named && typeof named === "object") {
    redacted.widgets_values_named = { ...named };
    delete redacted.widgets_values_named[widget.name];
  }

  const index = node?.widgets?.indexOf(widget) ?? -1;
  const positional = data.widgets_values;
  if (positional && index >= 0 && index < positional.length) {
    redacted.widgets_values = Array.isArray(positional)
      ? [...positional]
      : { ...positional };
    redacted.widgets_values[index] = "";
  }

  return redacted;
}
