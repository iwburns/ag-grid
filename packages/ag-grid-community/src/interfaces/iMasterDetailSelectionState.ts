import type { IServerSideGroupSelectionState, IServerSideSelectionState } from './iServerSideSelection';

export interface IMasterDetailSelectionState {
    master: Record<string, string>;
    detail: Record<
        string,
        string[] | IServerSideSelectionState | IServerSideGroupSelectionState | IMasterDetailSelectionState
    >;
}
