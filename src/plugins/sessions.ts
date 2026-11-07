import type { Middleware } from 'redux';
import type { docDrawing } from '../state/undo/undo';
import { DocActionTypes } from '../state/actions/docActions';
import { LibraryActionTypes } from '../state/actions/libraryActions';
import { RESTORE_SESSION } from './actions';
import { newIdentity } from './persistence';
import { prompts } from './prompts';
import { check } from './validation';

interface Session { id: string; state: docDrawing; revision: number; }
/** Retain complete undo history and file state per document; global libraries/UI stay shared. */
class DocumentSessions {
  private sessions = new Map<string, Session>();
  private listeners = new Set<() => void>();
  private store?: { getState(): docDrawing; dispatch(action: any): any };
  activeId = newIdentity();
  private counter = 0;
  saveActive?: () => Promise<any>;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.counter;
  attach(store: { getState(): docDrawing; dispatch(action: any): any }) { this.store = store; this.capture(); }
  capture() {
    if (!this.store) return;
    const state = this.store.getState(); const old = this.sessions.get(this.activeId);
    const changed = !old || old.state.docStore.present.drawing !== state.docStore.present.drawing || old.state.docStore.present.editLibrary !== state.docStore.present.editLibrary;
    this.sessions.set(this.activeId, { id: this.activeId, state, revision: (old?.revision || 0) + (changed ? 1 : 0) });
    if (changed || old?.state.altStore.file !== state.altStore.file || old?.state.altStore.savedVersion !== state.altStore.savedVersion) { this.counter++; for (const listener of this.listeners) listener(); }
  }
  fresh() { this.capture(); this.activeId = newIdentity(); }
  get(id?: string) { this.capture(); const session = this.sessions.get(id || this.activeId); check(session, 'DocumentClosed: document session is unavailable.'); return session; }
  list() {
    return Array.from(this.sessions.values()).map(session => ({ id: session.id, name: session.state.altStore.file?.name || 'Untitled', revision: session.revision,
      dirty: session.state.docStore.present.drawingVersion !== session.state.altStore.savedVersion, kind: session.state.docStore.present.editLibrary ? 'library' : 'schematic', active: session.id === this.activeId }));
  }
  anyDirty() { return this.list().some(s => s.dirty); }
  activate(id: string) {
    check(this.store && !this.store.getState().altStore.saveInProgress, 'A document is being saved.');
    this.capture(); const session = this.get(id); this.activeId = id;
    this.store.dispatch({ type: RESTORE_SESSION, snapshot: session.state }); this.counter++; for (const listener of this.listeners) listener();
  }
  async close(id: string) {
    const entry = this.list().find(s => s.id === id); check(entry, 'Document is closed.');
    if (entry.dirty) {
      const choice = await prompts.ask('Unsaved document', `Save changes to ${entry.name} before closing?`, [
        { value: 'save', label: 'Save' }, { value: 'discard', label: 'Discard changes' }, { value: 'cancel', label: 'Cancel' },
      ]);
      if (choice === 'cancel') return false;
      if (choice === 'save') { this.activate(id); await this.saveActive?.(); if (this.list().find(s => s.id === id)?.dirty) return false; }
    }
    check(this.sessions.size > 1, 'Create or open another document before closing the last document.');
    if (id === this.activeId) this.activate(Array.from(this.sessions.keys()).find(key => key !== id)!);
    this.sessions.delete(id); this.counter++; for (const listener of this.listeners) listener(); return true;
  }
  async resolveCloseAll() {
    for (const entry of this.list().filter(s => s.dirty)) {
      const choice = await prompts.ask('Unsaved document', `Save changes to ${entry.name} before quitting?`, [
        { value: 'save', label: 'Save' }, { value: 'discard', label: 'Discard changes' }, { value: 'cancel', label: 'Cancel' },
      ]);
      if (choice === 'cancel') return false;
      if (choice === 'save') { this.activate(entry.id); await this.saveActive?.(); if (this.list().find(s => s.id === entry.id)?.dirty) return false; }
    }
    return true;
  }
  async saveAll() {
    const original = this.activeId; const results: { id: string; saved: boolean; error?: string }[] = [];
    for (const entry of this.list().filter(s => s.dirty)) {
      try { this.activate(entry.id); await this.saveActive?.(); results.push({ id: entry.id, saved: !this.list().find(s => s.id === entry.id)?.dirty }); }
      catch (error) { results.push({ id: entry.id, saved: false, error: (error as Error).message }); }
    }
    this.activate(original); return results;
  }
}
export const documentSessions = new DocumentSessions();
export const sessionMiddleware: Middleware = store => next => action => {
  const create = action.type === DocActionTypes.SetDocument || action.type === LibraryActionTypes.EditLibrary;
  if (create) documentSessions.fresh();
  const result = next(action); documentSessions.capture(); return result;
};
export function restoreSessionState(state: docDrawing, snapshot: docDrawing): docDrawing {
  return { ...state, docStore: snapshot.docStore, altStore: { ...state.altStore,
    file: snapshot.altStore.file, savedVersion: snapshot.altStore.savedVersion, saveInProgress: false,
    panel: snapshot.altStore.panel, bottomPanel: snapshot.altStore.bottomPanel,
  } };
}
