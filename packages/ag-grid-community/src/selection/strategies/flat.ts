import { BeanStub } from '../../context/beanStub';
import type { RowNode } from '../../entities/rowNode';
import { _isMultiRowSelection, _isRowSelection } from '../../gridOptionsUtils';
import type { ISetNodesSelectedParams } from '../../interfaces/iSelectionService';
import type { ISelectionStrategy } from '../../interfaces/iSelectionStrategy';
import { BeanName, RowSelectedEvent, SelectionEventSourceType, _warn } from '../../main-umd-noStyles';
import { _normaliseFooterRef, _selectRowNode } from '../selectionUtils';

type State = Map<string, RowNode>;

export class FlatSelectionStrategy extends BeanStub implements ISelectionStrategy {
    beanName?: BeanName | undefined = 'flatSelectStrat';

    private state: State = new Map();

    postConstruct(): void {
        this.addManagedEventListeners({ rowSelected: this.onRowSelected.bind(this) });
    }

    getSelectedState(): string[] {
        return Array.from(this.state.keys());
    }

    getSelectedNodes(): RowNode<any>[] {
        return Array.from(this.state.values());
    }

    getSelectedRows(): any[] {
        return this.getSelectedNodes().map((n) => n.data);
    }

    setNodesSelected({
        nodes,
        newValue,
        clearSelection,
        suppressFinishActions,
        source,
        event,
    }: ISetNodesSelectedParams): number {
        const { beans, gos } = this;
        if (!_isRowSelection(gos) && newValue) {
            _warn(132);
            return 0;
        }

        if (nodes.length === 0) return 0;

        const isMultiRow = _isMultiRowSelection(gos);

        if (nodes.length > 1 && !isMultiRow) {
            _warn(130);
            return 0;
        }

        let updatedCount = 0;
        for (let i = 0; i < nodes.length; i++) {
            const rowNode = nodes[i];
            // if node is a footer, we don't do selection, just pass the info
            // to the sibling (the parent of the group)
            const node = _normaliseFooterRef(rowNode);

            if (node.rowPinned) {
                _warn(59);
                continue;
            }

            if (node.id === undefined) {
                _warn(60);
                continue;
            }

            const thisNodeWasSelected = _selectRowNode(beans, node, newValue, event, source);
            if (thisNodeWasSelected) {
                updatedCount++;
            }
        }

        // clear other nodes if not doing multi select
        if (!suppressFinishActions) {
            const clearOtherNodes = newValue && (clearSelection || !isMultiRow);
            if (clearOtherNodes) {
                updatedCount += this.clearOtherNodes(_normaliseFooterRef(nodes[0]), source);
            }

            // only if we selected something, then update groups and fire events
            if (updatedCount > 0) {
                // this is the very end of the 'action node', so we finished all the updates,
                // including any parent / child changes that this method caused
                this.dispatchSelectionChanged(source);
            }
        }

        return updatedCount;
    }

    private clearOtherNodes(rowNodeToKeepSelected: RowNode, source: SelectionEventSourceType): number {
        let updatedCount = 0;

        for (const [id, node] of this.state) {
            if (id !== rowNodeToKeepSelected.id) {
                updatedCount += this.setNodesSelected({
                    nodes: [node],
                    newValue: false,
                    clearSelection: false,
                    suppressFinishActions: true,
                    source,
                });
            }
        }

        return updatedCount;
    }

    private onRowSelected({ node }: RowSelectedEvent): void {
        if (node.isSelected()) {
            this.state.set(node.id!, node as RowNode);
        } else {
            this.state.delete(node.id!);
        }
    }
}
