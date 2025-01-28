import type {
    BeanName,
    ChangedPath,
    ISelectionService,
    ISetNodesSelectedParams,
    NamedBean,
    RowNode,
    SelectAllMode,
    SelectionEventSourceType,
    ServerSideRowGroupSelectionState,
    ServerSideRowSelectionState,
} from 'ag-grid-community';
import { BaseSelectionService, _error, _isMultiRowSelection } from 'ag-grid-community';

interface SelectionState {
    master: boolean;
    detail: Map<string, SelectionState>;
}

export interface IMasterDetailSelectionState {
    master: boolean;
    detail: Record<string, IMasterDetailSelectionState>;
}

export class MasterDetailSelectionService extends BaseSelectionService implements NamedBean, ISelectionService {
    beanName: BeanName = 'selectionSvc' as const;

    private selectionState: SelectionState = { master: false, detail: new Map() };

    public override postConstruct(): void {
        super.postConstruct();
    }

    getSelectionState():
        | string[]
        | ServerSideRowSelectionState
        | ServerSideRowGroupSelectionState
        | IMasterDetailSelectionState
        | null {
        throw new Error('unimplemented');
    }

    setSelectionState(
        state: string[] | ServerSideRowSelectionState | ServerSideRowGroupSelectionState | IMasterDetailSelectionState,
        source: SelectionEventSourceType
    ): void {
        throw new Error('unimplemented');
    }

    getSelectAllState(selectAll?: SelectAllMode | undefined): boolean | null {}

    getSelectedNodes(): RowNode<any>[] {}

    getSelectedRows(): any[] {}

    getSelectionCount(): number {}

    getBestCostNodeSelection(): RowNode<any>[] | undefined {}

    selectAllRowNodes(params: { source: SelectionEventSourceType; selectAll?: SelectAllMode | undefined }): void {}

    deselectAllRowNodes(params: { source: SelectionEventSourceType; selectAll?: SelectAllMode | undefined }): void {}

    public override setNodesSelected({
        nodes,
        newValue,
        clearSelection,
        event,
        source,
    }: ISetNodesSelectedParams): number {
        if (nodes.length === 0) return 0;

        const onlyThisNode = clearSelection && newValue;
        if (onlyThisNode || !_isMultiRowSelection(this.gos)) {
            if (nodes.length > 1) {
                _error(241);
                return 0;
            }
            this.deselectAllRowNodes({ source });
        }
    }

    protected override setRowSelectable(
        rowNode: RowNode<any>,
        newVal: boolean,
        suppressSelectionUpdate?: boolean | undefined
    ): void {}

    isEmpty(): boolean {
        return this.selectionState.master || this.selectionState.detail.size > 0;
    }

    syncInRowNode(rowNode: RowNode<any>, oldNode?: RowNode<any> | undefined): void {}

    hasNodesToSelect(selectAll?: SelectAllMode | undefined): boolean {}

    protected override updateSelectable(changedPath?: ChangedPath | undefined): void {}

    updateSelectableAfterGrouping(changedPath: ChangedPath | undefined): void {}

    handleSelectionEvent(
        event: MouseEvent | KeyboardEvent,
        rowNode: RowNode<any>,
        source: SelectionEventSourceType
    ): number {
        if (this.isRowSelectionBlocked(rowNode)) return 0;

        const selection = this.inferNodeSelections(rowNode, event.shiftKey, event.metaKey || event.ctrlKey, source);

        if (selection == null) return 0;

        this.selectionCtx.selectAll = false;

        if ('select' in selection) {
            if (selection.reset) {
            } else {
            }
        } else {
            return this.setNodesSelected({
                nodes: [selection.node],
                newValue: selection.newValue,
                clearSelection: selection.clearSelection,
                event,
                source,
            });
        }
    }

    reset(source: SelectionEventSourceType): void {}

    public override destroy(): void {}
}
