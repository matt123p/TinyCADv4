// Some response streams complete individual items but omit them from the final
// response.output snapshot. Retain explicit item/argument completion events;
// argument deltas alone must never authorize a tool call.
interface OutputEntry {
  item: any;
  done: boolean;
  argumentsDone?: string;
  contentDone: Set<number>;
}
export class ResponseOutput {
  private entries = new Map<number, OutputEntry>();
  private ids = new Map<string, number>();
  private entry(event: any, create: boolean): OutputEntry | undefined {
    const identities = [
      event.item_id,
      event.item?.id,
      event.item?.call_id && `call:${event.item.call_id}`,
    ].filter(Boolean);
    let index = identities
      .map((id) => this.ids.get(id))
      .find((value) => value !== undefined);
    if (
      index === undefined &&
      Number.isInteger(event.output_index) &&
      event.output_index >= 0
    )
      index = event.output_index;
    if (index === undefined && create)
      index = Math.max(-1, ...this.entries.keys()) + 1;
    if (index === undefined) return undefined;
    let entry = this.entries.get(index);
    if (!entry && create) {
      entry = {
        item: event.item_id ? { id: event.item_id } : {},
        done: false,
        contentDone: new Set(),
      };
      this.entries.set(index, entry);
    }
    if (entry) identities.forEach((id) => this.ids.set(id, index));
    return entry;
  }
  observe(event: any) {
    if (
      event.type === 'response.output_item.added' ||
      event.type === 'response.output_item.done'
    ) {
      if (!event.item || typeof event.item.type !== 'string') return;
      const entry = this.entry(event, true);
      entry.item = { ...entry.item, ...event.item };
      entry.done = event.type === 'response.output_item.done';
      return;
    }
    if (event.type === 'response.function_call_arguments.done') {
      const entry = this.entry(event, false);
      if (
        entry?.item.type === 'function_call' &&
        typeof event.arguments === 'string'
      )
        entry.argumentsDone = event.arguments;
      return;
    }
    if (
      [
        'response.content_part.done',
        'response.output_text.done',
        'response.output_text.annotation.added',
        'response.refusal.done',
      ].includes(event.type)
    ) {
      const entry = this.entry(event, true);
      if (!entry || (entry.item.type && entry.item.type !== 'message')) return;
      const index = event.content_index ?? 0;
      if (!Number.isInteger(index) || index < 0 || index > 10000)
        throw new Error('ChatGPT returned an invalid content index.');
      entry.item = { type: 'message', role: 'assistant', ...entry.item };
      entry.item.content ||= [];
      if (event.type === 'response.content_part.done') {
        entry.item.content[index] = event.part;
        entry.contentDone.add(index);
      } else if (event.type === 'response.output_text.done') {
        entry.item.content[index] = {
          ...entry.item.content[index],
          type: 'output_text',
          text: event.text,
          annotations: entry.item.content[index]?.annotations || [],
        };
        entry.contentDone.add(index);
      } else if (event.type === 'response.refusal.done') {
        entry.item.content[index] = { type: 'refusal', refusal: event.refusal };
        entry.contentDone.add(index);
      } else {
        const part = (entry.item.content[index] ||= {
          type: 'output_text',
          text: '',
          annotations: [],
        });
        part.annotations ||= [];
        if (event.annotation) part.annotations.push(event.annotation);
      }
    }
  }
  // Called only after a successful response.completed and a fully read stream.
  completed(snapshot: any[]): any[] {
    if (snapshot.length) return snapshot;
    const output: any[] = [];
    for (const [, entry] of [...this.entries].sort(([a], [b]) => a - b)) {
      const item = { ...entry.item };
      if (item.type === 'function_call') {
        if (!entry.done && entry.argumentsDone === undefined)
          throw new Error(
            'ChatGPT did not finish its tool call. No tools were executed for this reply.',
          );
        if (!item.arguments && entry.argumentsDone !== undefined)
          item.arguments = entry.argumentsDone;
        if (item.status === 'incomplete' || item.status === 'failed')
          throw new Error('ChatGPT returned an incomplete tool call.');
        if (!entry.done) item.status = 'completed';
        output.push(item);
      } else if (entry.done) output.push(item);
      else if (item.type === 'message' && entry.contentDone.size) {
        item.content = item.content.filter(
          (part: any, index: number) => part && entry.contentDone.has(index),
        );
        item.status = 'completed';
        output.push(item);
      }
    }
    return output;
  }
}
