import type {
    BeanName,
    IMasterDetailSelectionState,
    ISelectionService,
    ISetNodesSelectedParams,
    NamedBean,
    RowNode,
    RowSelectedEvent,
    RowSelectionMode,
    SelectAllMode,
    SelectionEventSourceType,
    SelectionState,
    ServerSideRowGroupSelectionState,
    ServerSideRowSelectionState,
} from 'ag-grid-community';
import { ChangedPath, _normaliseFooterRef } from 'ag-grid-community';
import {
    BaseSelectionService,
    _error,
    _getGroupSelection,
    _getGroupSelectsDescendants,
    _getRowSelectionMode,
    _isClientSideRowModel,
    _isRowSelection,
    _warn,
} from 'ag-grid-community';

type _SelState = string[] | ServerSideRowSelectionState | ServerSideRowGroupSelectionState | MasterDetailSelectionState;

export interface MasterDetailSelectionState {
    master: Map<string, RowNode>;
    detail: Map<string, _SelState>;
}
export class MasterDetailSelectionService extends BaseSelectionService implements NamedBean, ISelectionService {
    beanName: BeanName = 'selectionSvc' as const;

    private selectionState: MasterDetailSelectionState = { master: new Map(), detail: new Map() };

    private groupSelectsDescendants = false;
    private groupSelectsFiltered = false;
    private mode?: RowSelectionMode;

    public override postConstruct(): void {
        super.postConstruct();
        const { gos } = this;

        this.mode = _getRowSelectionMode(gos);
        this.groupSelectsDescendants = _getGroupSelectsDescendants(gos);
        this.groupSelectsFiltered = _getGroupSelection(gos) === 'filteredDescendants';

        this.addManagedPropertyListeners(['groupSelectsChildren', 'groupSelectsFiltered', 'rowSelection'], () => {
            const groupSelectsDescendants = _getGroupSelectsDescendants(gos);
            const selectionMode = _getRowSelectionMode(gos);
            const groupSelectsFiltered = _getGroupSelection(gos) === 'filteredDescendants';

            if (
                groupSelectsDescendants !== this.groupSelectsDescendants ||
                groupSelectsFiltered !== this.groupSelectsFiltered ||
                selectionMode !== this.mode
            ) {
                this.deselectAllRowNodes({ source: 'api' });
                this.groupSelectsDescendants = groupSelectsDescendants;
                this.groupSelectsFiltered = groupSelectsFiltered;
                this.mode = selectionMode;
            }
        });

        this.addManagedEventListeners({ rowSelected: this.onRowSelected.bind(this) });
    }

    getSelectionState(): SelectionState | null {
        const recursivelySerializeState = (source: _SelState) => {
            if (Array.isArray(source)) {
                return source;
            }

            if (!('master' in source)) {
                return source;
            }

            const target: IMasterDetailSelectionState = {
                master: {},
                detail: {},
            };

            for (const [id, node] of source.master) {
                target.master[id] = node.id!;
            }

            for (const [id, state] of source.detail) {
                target.detail[id] = recursivelySerializeState(state);
            }

            return target;
        };

        return recursivelySerializeState(this.selectionState);
    }

    setSelectionState(_state: SelectionState): void {
        // Make no assumptions
        const state = _state as unknown;

        if (Array.isArray(state)) {
            return _error(243);
        }

        const recursivelyDeserializeState = (source: unknown): MasterDetailSelectionState => {
            if (!source || typeof source !== 'object') {
                _error(243);
                throw new Error();
            }

            if (!('master' in source && 'detail' in source)) {
                _error(243);
                throw new Error();
            }

            if (!source.master || typeof source.master !== 'object') {
                _error(243);
                throw new Error();
            }

            if (!source.detail || typeof source.detail != 'object') {
                _error(243);
                throw new Error();
            }

            const target: MasterDetailSelectionState = {
                master: new Map(),
                detail: new Map(),
            };

            for (const [key, value] of Object.entries(source.master)) {
                target.master.set(key, value);
            }

            for (const [key, value] of Object.entries(source.detail)) {
                target.detail.set(key, recursivelyDeserializeState(value));
            }

            return target;
        };

        try {
            this.selectionState = recursivelyDeserializeState(state);
        } catch (error) {
            // do nothing
        }
    }

    getSelectAllState(selectAll?: SelectAllMode | undefined): boolean | null {
        return null;
    }

    getSelectedNodes(): RowNode<any>[] {
        return Array.from(this.selectionState.master.values());
    }

    getSelectedRows(): any[] {
        return this.getSelectedNodes().map((n) => n.data);
    }

    getSelectionCount(): number {
        return this.selectionState.master.size;
    }

    getBestCostNodeSelection(): RowNode<any>[] | undefined {
        return;
    }

    selectAllRowNodes(params: { source: SelectionEventSourceType; selectAll?: SelectAllMode | undefined }): void {}

    deselectAllRowNodes(params: { source: SelectionEventSourceType; selectAll?: SelectAllMode | undefined }): void {}

    public override setNodesSelected({
        nodes,
        newValue,
        clearSelection,
        suppressFinishActions,
        event,
        source,
    }: ISetNodesSelectedParams): number {
        if (!_isRowSelection(this.gos) && newValue) {
            _warn(132);
            return 0;
        }

        if (nodes.length === 0) return 0;

        if (nodes.length > 1 && !this.isMultiSelect()) {
            _warn(130);
            return 0;
        }

        let updatedCount = 0;
        for (let i = 0; i < nodes.length; i++) {
            const rowNode = nodes[i];
            // if node is a footer, we don't do selection, just pass the info
            // to the sibling (the parent of the group)
            const node = _normaliseFooterRef(rowNode);

            // when groupSelectsFiltered, then this node may end up indeterminate despite
            // trying to set it to true / false. this group will be calculated further on
            // down when we call updateGroupsFromChildrenSelections(). we need to skip it
            // here, otherwise the updatedCount would include it.
            const skipThisNode = this.groupSelectsFiltered && node.group;

            if (node.rowPinned) {
                _warn(59);
                continue;
            }

            if (node.id === undefined) {
                _warn(60);
                continue;
            }

            if (!skipThisNode) {
                const thisNodeWasSelected = this.selectRowNode(node, newValue, event, source);
                if (thisNodeWasSelected) {
                    updatedCount++;
                }
            }

            if (this.groupSelectsDescendants && node.childrenAfterGroup?.length) {
                updatedCount += this.selectChildren(node, newValue, source);
            }
        }

        // clear other nodes if not doing multi select
        if (!suppressFinishActions) {
            const clearOtherNodes = newValue && (clearSelection || !this.isMultiSelect());
            if (clearOtherNodes) {
                updatedCount += this.clearOtherNodes(_normaliseFooterRef(nodes[0]), source);
            }

            // only if we selected something, then update groups and fire events
            if (updatedCount > 0) {
                this.updateGroupsFromChildrenSelections(source);

                // this is the very end of the 'action node', so we finished all the updates,
                // including any parent / child changes that this method caused
                this.dispatchSelectionChanged(source);
            }
        }
        return updatedCount;
    }

    // not to be mixed up with 'cell range selection' where you drag the mouse, this is row range selection, by
    // holding down 'shift'.
    private selectRange(nodesToSelect: readonly RowNode[], value: boolean, source: SelectionEventSourceType): number {
        let updatedCount = 0;

        nodesToSelect.forEach((rowNode) => {
            if (rowNode.group && this.groupSelectsDescendants) {
                return;
            }

            const nodeWasSelected = this.selectRowNode(rowNode, value, undefined, source);
            if (nodeWasSelected) {
                updatedCount++;
            }
        });

        if (updatedCount > 0) {
            this.updateGroupsFromChildrenSelections(source);

            this.dispatchSelectionChanged(source);
        }

        return updatedCount;
    }

    private selectChildren(node: RowNode, newValue: boolean, source: SelectionEventSourceType): number {
        const children = this.groupSelectsFiltered ? node.childrenAfterAggFilter : node.childrenAfterGroup;

        if (!children) {
            return 0;
        }

        return this.setNodesSelected({
            newValue: newValue,
            clearSelection: false,
            suppressFinishActions: true,
            source,
            nodes: children,
        });
    }

    public override updateGroupsFromChildrenSelections(
        source: SelectionEventSourceType,
        changedPath?: ChangedPath
    ): boolean {
        // we only do this when group selection state depends on selected children
        if (!this.groupSelectsDescendants) {
            return false;
        }
        const { gos, rowModel } = this.beans;
        // also only do it if CSRM (code should never allow this anyway)
        if (!_isClientSideRowModel(gos, rowModel)) {
            return false;
        }

        const rootNode = rowModel.rootNode;
        if (!rootNode) {
            return false;
        }

        if (!changedPath) {
            changedPath = new ChangedPath(true, rootNode);
            changedPath.active = false;
        }

        let selectionChanged = false;

        changedPath.forEachChangedNodeDepthFirst((rowNode) => {
            if (rowNode !== rootNode) {
                const selected = this.calculateSelectedFromChildren(rowNode);
                selectionChanged =
                    this.selectRowNode(rowNode, selected === null ? false : selected, undefined, source) ||
                    selectionChanged;
            }
        });

        return selectionChanged;
    }

    private clearOtherNodes(rowNodeToKeepSelected: RowNode, source: SelectionEventSourceType): number {
        const groupsToRefresh = new Map<string, RowNode>();
        let updatedCount = 0;
        this.selectionState.master.forEach((otherRowNode) => {
            if (otherRowNode && otherRowNode.id !== rowNodeToKeepSelected.id) {
                const rowNode = this.selectionState.master.get(otherRowNode.id!)!;
                updatedCount += this.setNodesSelected({
                    nodes: [rowNode],
                    newValue: false,
                    clearSelection: false,
                    suppressFinishActions: true,
                    source,
                });

                if (this.groupSelectsDescendants && otherRowNode.parent) {
                    groupsToRefresh.set(otherRowNode.parent.id!, otherRowNode.parent);
                }
            }
        });

        groupsToRefresh.forEach((group) => {
            const selected = this.calculateSelectedFromChildren(group);
            this.selectRowNode(group, selected === null ? false : selected, undefined, source);
        });

        return updatedCount;
    }

    protected override setRowSelectable(
        rowNode: RowNode<any>,
        newVal: boolean,
        suppressSelectionUpdate?: boolean | undefined
    ): void {}

    isEmpty(): boolean {
        return this.selectionState.master.size === 0;
    }

    syncInRowNode(rowNode: RowNode<any>, oldNode?: RowNode<any> | undefined): void {}

    hasNodesToSelect(selectAll?: SelectAllMode | undefined): boolean {
        return true;
    }

    protected override updateSelectable(changedPath?: ChangedPath | undefined): void {}

    updateSelectableAfterGrouping(changedPath: ChangedPath | undefined): void {}

    handleSelectionEvent(
        event: MouseEvent | KeyboardEvent,
        rowNode: RowNode<any>,
        source: SelectionEventSourceType
    ): number {
        if (this.isRowSelectionBlocked(rowNode)) return 0;

        const selection = this.inferNodeSelections(rowNode, event.shiftKey, event.metaKey || event.ctrlKey, source);

        if (selection == null) {
            return 0;
        }

        this.selectionCtx.selectAll = false;

        if ('select' in selection) {
            if (selection.reset) {
                this.resetNodes();
            } else {
                this.selectRange(selection.deselect, false, source);
            }
            return this.selectRange(selection.select, true, source);
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

    private onRowSelected({ node }: RowSelectedEvent): void {
        const {
            groupSelectsDescendants,
            selectionState,
            beans: { masterDetailSvc },
        } = this;
        // we do not store the group rows when the groups select children
        if (groupSelectsDescendants && node.group) {
            return;
        }

        const id = node.id!;
        const { api } = masterDetailSvc?.getDetailGridInfo(node as RowNode) ?? {};

        if (node.isSelected()) {
            selectionState.master.set(id, node as RowNode);
            api?.selectAll(undefined, 'masterGrid');
        } else {
            selectionState.master.delete(id);
            api?.deselectAll(undefined, 'masterGrid');
        }
    }

    private resetNodes(): void {
        this.selectionState.master.forEach((node) => {
            node.setSelected(false);
        });
        this.selectionState.master.clear();
        // TODO clear detail state
    }

    reset(source: SelectionEventSourceType): void {}

    public override destroy(): void {}
}
