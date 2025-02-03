import { BeanStub } from 'ag-grid-community';
import type {
    ISelectionStrategy,
    RowNode,
    ServerSideRowGroupSelectionState,
    ServerSideRowSelectionState,
} from 'ag-grid-community';

type _SelState = string[] | ServerSideRowSelectionState | ServerSideRowGroupSelectionState | MasterDetailSelectionState;

export interface MasterDetailSelectionState {
    master: Map<string, RowNode>;
    detail: Map<string, _SelState>;
}

export class MasterDetailDefaultSelectionStrategy extends BeanStub implements ISelectionStrategy {
    postConstruct(): void {}
}
