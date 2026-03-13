import { Dispatch } from 'redux';
import { Coordinate } from '../../model/dsnItem';
import {
  actionPasteEvent,
  actionSelectDialog,
} from '../../state/dispatcher/AppDispatcher';
import { docDrawing } from '../../state/undo/undo';

export let apiServer =
  window.location.hostname === 'localhost' ? '' : 'https://www.tinycad.net';

export interface SearchLabel {
  labelId: number;
  name: string;
  symbolSymbolLabel: any[];
}

export interface SearchSymbol {
  symbolID: number;
  nameID: number;
  name: string;
  description: string;
  owner: string;
  locked: boolean;
  labels: SearchLabel[];
  downloads: number;
  created: Date;
  attributes?: any;
}

export interface SearchResult {
  error: string;
  total: number;
  pageSize: number;
  symbols: SearchSymbol[];
  labels: string[];
}

export function error(dispatch: Dispatch, message: string) {
  dispatch(actionSelectDialog('io_failure', { message: error }));
}

export function Search(key: string) {
  return new Promise<SearchResult>((resolve) => {
    let page = 1;
    let orderBy = 'N';

    if (key && key.length > 0) {
      let p = new URLSearchParams(window.location.search);
      p.set('key', key);
      p.set('page', page.toString());
      p.set('orderBy', orderBy);

      fetch(`${apiServer}/api/search/Search?` + p.toString(), {
        credentials: 'include',
        mode: 'cors',
      })
        .then((response) => {
          if (!response.ok) {
            throw response.statusText;
          }
          return response;
        })
        .then((r) => r.json())
        .then((data) =>
          resolve({
            ...data,
            error: null,
          }),
        )
        .catch((e) => {
          resolve({
            error: `Problem talking to server: ${e} - please try again later`,
            total: 0,
            pageSize: 0,
            symbols: [],
            labels: [],
          });
        });
    } else {
      resolve({
        error: null,
        total: 0,
        pageSize: 0,
        symbols: [],
        labels: [],
      });
    }
  });
}

export function FetchSymbolData(symbol: SearchSymbol) {
  let p = new URLSearchParams(window.location.search);
  p.set('id', symbol.symbolID.toString());
  p.set('name', symbol.name);
  return fetch(`${apiServer}/api/search/copy?${p.toString()}`, {
    credentials: 'include',
    method: 'GET',
    mode: 'cors',
  });
}

export function SelectSymbol(symbol: SearchSymbol, pos: Coordinate) {
  return (dispatch: Dispatch, getState: { (): docDrawing }) => {
    FetchSymbolData(symbol)
      .then((response) => {
        if (response.status === 200) {
          response.text().then((text) => {
            dispatch(actionPasteEvent(text, pos));
          });
        } else {
          error(
            dispatch,
            'There was a problem talking to the TinyCAD.net server - please try again at a later time.',
          );
        }
      })
      .catch((e) => {
        error(
          dispatch,
          'There was a problem talking to the TinyCAD.net server - please try again at a later time.',
        );
      });
  };
}
