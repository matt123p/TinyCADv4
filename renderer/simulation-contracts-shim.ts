// Only the standalone drawing bundle uses this adapter. The application keeps
// the secure UUID generator from the original simulation contracts.
export * from '../src/simulation/contracts';
export { newServerIdentity as newIdentity } from './serverGlobalId';
