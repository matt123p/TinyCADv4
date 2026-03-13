import { DocItem } from '../../model/dsnItem';
import { UserConfig } from '../stores/altStoreReducer';

export enum ConfigActionTypes {
  ConfigUpdateConfig = '[Config] UpdateConfig',
}

export interface ConfigUpdateConfig {
  type: ConfigActionTypes.ConfigUpdateConfig;
  config: UserConfig;
}

export type ConfigActions = ConfigUpdateConfig;
