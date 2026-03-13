import { CurrentUser } from '../stores/altStoreReducer';

export enum UserLoginActionTypes {
  UserLoginLoginOK = '[UserLogin] UserLoginLoginOK',
  UserLoginLoginError = '[UserLogin] UserLoginLoginError',
  BrowserError = '[UserLogin] BrowserError',
}

export interface UserLoginLoginOK {
  type: UserLoginActionTypes.UserLoginLoginOK;
  user: CurrentUser;
}

export interface UserLoginLoginError {
  type: UserLoginActionTypes.UserLoginLoginError;
  error: string;
}

export interface BrowserError {
  type: UserLoginActionTypes.BrowserError;
}

export type UserLoginActions =
  | UserLoginLoginOK
  | UserLoginLoginError
  | BrowserError;
