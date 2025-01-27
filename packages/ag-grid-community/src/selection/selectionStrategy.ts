import type { Bean } from '../context/bean';
import { BeanStub } from '../context/beanStub';
import type { RowNode } from '../entities/rowNode';
import type { SelectionEventSourceType } from '../events';
import { _isRowSelection } from '../gridOptionsUtils';
import type { ISetNodesSelectedParams } from '../interfaces/iSelectionService';
import { _warn } from '../validation/logging';
import {
    _calculateSelectedFromChildren,
    _selectRowNode,
    _updateGroupsFromChildrenSelections,
} from './baseSelectionService';

export interface ISelectionStrategy<TData = any> extends Bean {
    getSelectedState(): string[];
    selectNode(node: RowNode<TData>, value: boolean | undefined): void;
    setNodesSelected(params: ISetNodesSelectedParams): number;
    selectRange(nodesToSelect: readonly RowNode[], value: boolean, source: SelectionEventSourceType): number;
    getSelectedNodes(): RowNode<TData>[];
    getSelectedRows(): TData[];
    getSelectionCount(): number;
    isEmpty(): boolean;
    // selectAllRowNodes(params: { source: SelectionEventSourceType; selectAll?: SelectAllMode }): void;
    // deselectAllRowNodes(params: { source: SelectionEventSourceType; selectAll?: SelectAllMode }): void;
    // getSelectAllState(selectAll?: SelectAllMode): boolean | null;
    // deleteSelectionStateFromParent(parentRoute: string[], removedNodeIds: string[]): boolean;
    filterFromSelection(predicate: (node: RowNode) => boolean): void;
    syncInOldRowNode(rowNode: RowNode, oldNode?: RowNode): void;
    syncInNewRowNode(rowNode: RowNode): void;
    resetNodes(): void;
    setParams(params: {
        isMultiSelect: boolean;
        groupSelectsFiltered: boolean;
        groupSelectsDescendants: boolean;
    }): void;
}

export class DefaultSelectionStrategy<TData = any> extends BeanStub implements ISelectionStrategy<TData> {
    private selectedNodes = new Map<string, RowNode>();
    private groupSelectsFiltered: boolean;
    private groupSelectsDescendants: boolean;
    private isMultiSelect: boolean;

    setParams(params: {
        isMultiSelect: boolean;
        groupSelectsFiltered: boolean;
        groupSelectsDescendants: boolean;
    }): void {
        this.isMultiSelect = params.isMultiSelect;
        this.groupSelectsDescendants = params.groupSelectsDescendants;
        this.groupSelectsFiltered = params.groupSelectsFiltered;
    }

    getSelectedState(): string[] {
        return Array.from(this.selectedNodes.keys());
    }

    getSelectedNodes(): RowNode<TData>[] {
        return Array.from(this.selectedNodes.values());
    }

    getSelectedRows(): TData[] {
        const rows = [];
        for (const node of this.selectedNodes.values()) {
            rows.push(node.data);
        }
        return rows;
    }

    getSelectionCount(): number {
        return this.selectedNodes.size;
    }

    isEmpty(): boolean {
        return this.selectedNodes.size === 0;
    }

    selectNode(node: RowNode<TData>, value: boolean | undefined): void {
        if (value) {
            this.selectedNodes.set(node.id!, node);
        } else {
            this.selectedNodes.delete(node.id!);
        }
    }

    public setNodesSelected({
        newValue,
        clearSelection,
        suppressFinishActions,
        nodes,
        event,
        source,
    }: ISetNodesSelectedParams): number {
        if (!_isRowSelection(this.gos) && newValue) {
            _warn(132);
            return 0;
        }

        if (nodes.length === 0) return 0;

        if (nodes.length > 1 && !this.isMultiSelect) {
            _warn(130);
            return 0;
        }

        let updatedCount = 0;
        for (let i = 0; i < nodes.length; i++) {
            const rowNode = nodes[i];
            // if node is a footer, we don't do selection, just pass the info
            // to the sibling (the parent of the group)
            const node = _normaliseNodeReference(rowNode);

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
                const thisNodeWasSelected = _selectRowNode(this.beans, node, newValue, event, source);
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
            const clearOtherNodes = newValue && (clearSelection || !this.isMultiSelect);
            if (clearOtherNodes) {
                updatedCount += this.clearOtherNodes(nodes[0], source);
            }

            // only if we selected something, then update groups
            if (updatedCount > 0) {
                _updateGroupsFromChildrenSelections(this.beans, this.groupSelectsDescendants, source);
            }
        }

        return updatedCount;
    }

    public selectRange(nodesToSelect: readonly RowNode[], value: boolean, source: SelectionEventSourceType): number {
        const { beans, groupSelectsDescendants } = this;
        let updatedCount = 0;

        nodesToSelect.forEach((rowNode) => {
            if (rowNode.group && this.groupSelectsDescendants) {
                return;
            }

            const nodeWasSelected = _selectRowNode(beans, rowNode, value, undefined, source);
            if (nodeWasSelected) {
                updatedCount++;
            }
        });

        if (updatedCount > 0) {
            _updateGroupsFromChildrenSelections(beans, groupSelectsDescendants, source);
        }

        return updatedCount;
    }

    public filterFromSelection(predicate: (node: RowNode) => boolean): void {
        const newSelectedNodes: Map<string, RowNode> = new Map();
        this.selectedNodes.forEach((rowNode, key) => {
            if (predicate(rowNode)) {
                newSelectedNodes.set(key, rowNode);
            }
        });
        this.selectedNodes = newSelectedNodes;
    }

    // if the id has changed for the node, then this means the rowNode
    // is getting used for a different data item, which breaks
    // our selectedNodes, as the node now is mapped by the old id
    // which is inconsistent. so to keep the old node as selected,
    // we swap in the clone (with the old id and old data). this means
    // the oldNode is effectively a daemon we keep a reference to,
    // so if client calls api.getSelectedNodes(), it gets the daemon
    // in the result. when the client un-selects, the reference to the
    // daemon is removed. the daemon, because it's an oldNode, is not
    // used by the grid for rendering, it's a copy of what the node used
    // to be like before the id was changed.
    public syncInOldRowNode(rowNode: RowNode, oldNode?: RowNode): void {
        if (oldNode && rowNode.id !== oldNode.id) {
            const oldNodeSelected = this.selectedNodes.get(oldNode.id!) == rowNode;
            if (oldNodeSelected) {
                this.selectedNodes.set(oldNode.id!, oldNode);
            }
        }
    }

    public syncInNewRowNode(rowNode: RowNode): void {
        if (this.selectedNodes.has(rowNode.id!)) {
            rowNode.__selected = true;
            this.selectedNodes.set(rowNode.id!, rowNode);
        } else {
            rowNode.__selected = false;
        }
    }

    public resetNodes(): void {
        const { beans, selectedNodes } = this;
        selectedNodes.forEach((node) => {
            _selectRowNode(beans, _normaliseNodeReference(node), false);
        });
        selectedNodes.clear();
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

    private clearOtherNodes(rowNodeToKeepSelected: RowNode, source: SelectionEventSourceType): number {
        const { beans, selectedNodes, groupSelectsDescendants } = this;
        const groupsToRefresh = new Map<string, RowNode>();
        let updatedCount = 0;
        selectedNodes.forEach((otherRowNode) => {
            if (otherRowNode && otherRowNode.id !== rowNodeToKeepSelected.id) {
                const rowNode = selectedNodes.get(otherRowNode.id!)!;
                updatedCount += this.setNodesSelected({
                    nodes: [rowNode],
                    newValue: false,
                    clearSelection: false,
                    suppressFinishActions: true,
                    source,
                });

                if (groupSelectsDescendants && otherRowNode.parent) {
                    groupsToRefresh.set(otherRowNode.parent.id!, otherRowNode.parent);
                }
            }
        });

        groupsToRefresh.forEach((group) => {
            const selected = _calculateSelectedFromChildren(group);
            _selectRowNode(beans, group, selected === null ? false : selected, undefined, source);
        });

        return updatedCount;
    }
}

export function _normaliseNodeReference(node: RowNode): RowNode {
    return node.footer ? node.sibling : node;
}
