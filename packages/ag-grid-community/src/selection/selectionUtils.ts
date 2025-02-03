import type { BeanCollection } from '../context/context';
import type { RowNode } from '../entities/rowNode';
import { _createGlobalRowEvent } from '../entities/rowNodeUtils';
import type { SelectionEventSourceType } from '../events';

/** Selection state of footer nodes is a clone of their siblings, so always act on sibling rather than footer */
export function _normaliseFooterRef(node: RowNode): RowNode {
    return node.footer ? node.sibling : node;
}

export function _selectRowNode(
    beans: BeanCollection,
    rowNode: RowNode,
    newValue?: boolean,
    e?: Event,
    source: SelectionEventSourceType = 'api'
): boolean {
    const { eventSvc, gos } = beans;
    // we only check selectable when newValue=true (ie selecting) to allow unselecting values,
    // as selectable is dynamic, need a way to unselect rows when selectable becomes false.
    const selectionNotAllowed = !rowNode.selectable && newValue;
    const selectionNotChanged = rowNode.__selected === newValue;

    if (selectionNotAllowed || selectionNotChanged) {
        return false;
    }

    rowNode.__selected = newValue;

    rowNode.dispatchRowEvent('rowSelected');

    // in case of root node, sibling may have service while this row may not
    const sibling = rowNode.sibling;
    if (sibling && sibling.footer && sibling.__localEventService) {
        sibling.dispatchRowEvent('rowSelected');
    }

    eventSvc.dispatchEvent({
        ..._createGlobalRowEvent(rowNode, gos, 'rowSelected'),
        event: e || null,
        source,
    });

    return true;
}
