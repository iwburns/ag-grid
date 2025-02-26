import { _getClientSideRowModel } from '../api/rowModelApiUtils';
import type { NamedBean } from '../context/bean';
import { BeanStub } from '../context/beanStub';
import type { BeanCollection } from '../context/context';
import type { GridOptions } from '../entities/gridOptions';
import { ROW_ID_PREFIX_BOTTOM_PINNED, ROW_ID_PREFIX_TOP_PINNED, RowNode } from '../entities/rowNode';
import type { CssVariablesChanged } from '../events';
import { _getRowHeightForNode, _getRowIdCallback } from '../gridOptionsUtils';
import type { RowPinnedType } from '../interfaces/iRowNode';
import { _removeFromArray } from '../utils/array';
import { _warn } from '../validation/logging';

interface IPinnedRowModel {
    isEmpty(floating: NonNullable<RowPinnedType>): boolean;
    ensureRowHeightsValid(): boolean;
    getTotalHeight(floating: NonNullable<RowPinnedType>): number;
    getRowCount(floating: NonNullable<RowPinnedType>): number;
    getRowByIndex(index: number, floating: NonNullable<RowPinnedType>): RowNode | undefined;
    getRowById(id: string, floating: NonNullable<RowPinnedType>): RowNode | undefined;
    forEachRow(floating: NonNullable<RowPinnedType>, callback: (node: RowNode, index: number) => void): void;
    pinRow(node: RowNode, floating: NonNullable<RowPinnedType>): void;
    unpinRow(node: RowNode, floating: NonNullable<RowPinnedType>): void;
}
class StaticPinnedRowModel implements IPinnedRowModel {
    constructor(
        private beans: BeanCollection,
        pinnedRowModel: PinnedRowModel
    ) {
        const gos = beans.gos;
        this.setPinnedRowData(gos.get('pinnedTopRowData'), 'top');
        this.setPinnedRowData(gos.get('pinnedBottomRowData'), 'bottom');
        pinnedRowModel.addManagedPropertyListener('pinnedTopRowData', (e) =>
            this.setPinnedRowData(e.currentValue, 'top')
        );
        pinnedRowModel.addManagedPropertyListener('pinnedBottomRowData', (e) =>
            this.setPinnedRowData(e.currentValue, 'bottom')
        );
    }

    private nextId = 0;
    private pinnedTopRows = createCache<RowNode>();
    private pinnedBottomRows = createCache<RowNode>();

    private getCache(floating: RowPinnedType): OrderedCache<RowNode> {
        return floating === 'top' ? this.pinnedTopRows : this.pinnedBottomRows;
    }

    isEmpty(floating: RowPinnedType): boolean {
        return this.getCache(floating).order.length === 0;
    }

    ensureRowHeightsValid(): boolean {
        let anyChange = false;
        let rowTop = 0;
        const updateRowHeight = (rowNode: RowNode) => {
            if (rowNode.rowHeightEstimated) {
                rowTop += setRowTopAndRowIndex(this.beans, rowNode, rowTop);
                anyChange = true;
            }
        };
        forEach(this.pinnedBottomRows, updateRowHeight);
        rowTop = 0;
        forEach(this.pinnedTopRows, updateRowHeight);

        this.beans.eventSvc.dispatchEvent({
            type: 'pinnedHeightChanged',
        });

        return anyChange;
    }

    getTotalHeight(floating: RowPinnedType): number {
        return getTotalHeight(this.getCache(floating));
    }

    getRowCount(floating: RowPinnedType): number {
        return getSize(this.getCache(floating));
    }

    getRowById(id: string, floating: RowPinnedType): RowNode<any> | undefined {
        return getById(this.getCache(floating), id);
    }

    getRowByIndex(index: number, floating: RowPinnedType): RowNode<any> | undefined {
        return getByIndex(this.getCache(floating), index);
    }

    forEachRow(floating: RowPinnedType, callback: (node: RowNode<any>, index: number) => void): void {
        forEach(this.getCache(floating), callback);
    }

    pinRow(_node: RowNode<any>, _floating: RowPinnedType): void {
        // do nothing
    }

    unpinRow(_node: RowNode<any>, _floating: RowPinnedType): void {
        // do nothing
    }

    private setPinnedRowData(rowData: any[] | undefined, floating: NonNullable<RowPinnedType>): void {
        this.updateNodesFromRowData(rowData, floating);
        this.beans.eventSvc.dispatchEvent({
            type: 'pinnedRowDataChanged',
        });
    }

    /**
     * Updates existing RowNode instances and creates new ones if necessary
     *
     * Setting data as `undefined` will clear row nodes
     */
    private updateNodesFromRowData(allData: any[] | undefined, floating: NonNullable<RowPinnedType>): void {
        const nodes = this.getCache(floating);

        if (allData === undefined) {
            nodes.order.length = 0;
            nodes.cache = {};
            return;
        }

        const beans = this.beans;
        const getRowId = _getRowIdCallback(beans.gos);
        const idPrefix = floating === 'top' ? ROW_ID_PREFIX_TOP_PINNED : ROW_ID_PREFIX_BOTTOM_PINNED;

        // We'll want to remove all nodes that aren't matched to data
        const nodesToRemove = new Set(nodes.order);

        // Data that matches based on ID can nonetheless still appear in a different order than before
        const newOrder: string[] = [];

        // Used for catching duplicate IDs/rows within `allData` itself
        const dataIds = new Set<string>();

        let nextRowTop = 0;
        let i = -1;
        for (const data of allData) {
            const id = getRowId?.({ data, level: 0, rowPinned: floating }) ?? idPrefix + this.nextId++;

            if (dataIds.has(id)) {
                _warn(96, { id, data });
                continue;
            }

            i++;
            dataIds.add(id);
            newOrder.push(id);

            const existingNode = getById(nodes, id);
            if (existingNode !== undefined) {
                if (existingNode.data !== data) {
                    existingNode.setData(data);
                }
                nextRowTop += setRowTopAndRowIndex(beans, existingNode, nextRowTop, i);

                // existing nodes that are re-used/updated shouldn't be deleted
                nodesToRemove.delete(id);
            } else {
                // new node
                const rowNode = new RowNode(this.beans);
                rowNode.id = id;
                rowNode.data = data;
                rowNode.rowPinned = floating;
                nextRowTop += setRowTopAndRowIndex(beans, rowNode, nextRowTop, i);
                setValue(nodes, id, rowNode);
            }
        }

        nodesToRemove.forEach((id) => {
            getById(nodes, id)?.clearRowTopAndRowIndex();
            delete nodes.cache[id];
        });

        nodes.order = newOrder;
    }
}

function getOtherContainer(floating: NonNullable<RowPinnedType>): NonNullable<RowPinnedType> {
    return floating === 'bottom' ? 'top' : 'bottom';
}

class DynamicPinnedRowModel implements IPinnedRowModel {
    private top = createCache<RowNode>();
    private bottom = createCache<RowNode>();
    private indexMap = new Map<string, number | null>();

    constructor(private beans: BeanCollection) {}

    private getCache(floating: NonNullable<RowPinnedType>): OrderedCache<RowNode> {
        return floating === 'top' ? this.top : this.bottom;
    }

    isEmpty(floating: NonNullable<RowPinnedType>): boolean {
        return this.getCache(floating).order.length === 0;
    }

    ensureRowHeightsValid(): boolean {
        let anyChange = false;
        let rowTop = 0;
        const updateRowHeight = (rowNode: RowNode) => {
            if (rowNode.rowHeightEstimated) {
                rowTop += setRowTopAndRowIndex(this.beans, rowNode, rowTop);
                anyChange = true;
            }
        };
        forEach(this.top, updateRowHeight);
        rowTop = 0;
        forEach(this.bottom, updateRowHeight);

        this.beans.eventSvc.dispatchEvent({
            type: 'pinnedHeightChanged',
        });

        return anyChange;
    }

    getTotalHeight(floating: NonNullable<RowPinnedType>): number {
        return getTotalHeight(this.getCache(floating));
    }

    getRowCount(floating: NonNullable<RowPinnedType>): number {
        return getSize(this.getCache(floating));
    }

    getRowById(id: string, floating: NonNullable<RowPinnedType>): RowNode<any> | undefined {
        return getById(this.getCache(floating), id);
    }

    getRowByIndex(index: number, floating: NonNullable<RowPinnedType>): RowNode<any> | undefined {
        return getByIndex(this.getCache(floating), index);
    }

    forEachRow(floating: NonNullable<RowPinnedType>, callback: (node: RowNode<any>, index: number) => void): void {
        forEach(this.getCache(floating), callback);
    }

    pinRow(node: RowNode<any>, floating: NonNullable<RowPinnedType>): void {
        if (this.getRowById(node.id!, floating)) return;

        const cache = this.getCache(floating);
        const size = this.getRowCount(floating);
        let rowTop = 0;
        forEach(cache, (rowNode) => {
            rowTop += rowNode.rowTop ?? 0;
        });

        if (this.getRowById(node.id!, getOtherContainer(floating))) {
            clearValue(this.getCache(getOtherContainer(floating)), node.id!);
        } else {
            this.indexMap.set(node.id!, node.rowIndex);
            _getClientSideRowModel(this.beans)?.updateRowData({ remove: [node.data] });
        }

        setRowTopAndRowIndex(this.beans, node, rowTop, size);

        setValue(cache, node.id!, node);
        node.rowPinned = floating;

        this.beans.eventSvc.dispatchEvent({
            type: 'pinnedRowDataChanged',
        });
    }

    unpinRow(node: RowNode<any>, floating: NonNullable<RowPinnedType>): void {
        if (!this.getRowById(node.id!, floating)) return;

        const idx = this.indexMap.get(node.id!);
        _getClientSideRowModel(this.beans)?.updateRowData({ add: [node.data], addIndex: idx });

        clearValue(this.getCache(floating), node.id!);
        node.rowPinned = undefined;

        this.beans.eventSvc.dispatchEvent({
            type: 'pinnedRowDataChanged',
        });
    }
}

export class PinnedRowModel extends BeanStub implements NamedBean {
    beanName = 'pinnedRowModel' as const;

    private innerRowModel: IPinnedRowModel;

    public postConstruct(): void {
        const gos = this.gos;

        const init = (rowPinning: GridOptions['enableRowPinning']) => {
            if (rowPinning) {
                this.innerRowModel = new DynamicPinnedRowModel(this.beans);
            } else {
                this.innerRowModel = new StaticPinnedRowModel(this.beans, this);
            }
        };

        init(gos.get('enableRowPinning'));

        this.addManagedPropertyListener('enableRowPinning', (e) => {
            init(e.currentValue);
        });

        this.addManagedEventListeners({ gridStylesChanged: this.onGridStylesChanges.bind(this) });
    }

    public isEmpty(floating: RowPinnedType): boolean {
        return !!floating && this.innerRowModel.isEmpty(floating);
    }

    public isRowsToRender(floating: RowPinnedType): boolean {
        return !this.isEmpty(floating);
    }

    private onGridStylesChanges(e: CssVariablesChanged) {
        if (e.rowHeightChanged) {
            const estimateRowHeight = (rowNode: RowNode) => {
                rowNode.setRowHeight(rowNode.rowHeight, true);
            };
            this.innerRowModel.forEachRow('bottom', estimateRowHeight);
            this.innerRowModel.forEachRow('top', estimateRowHeight);
        }
    }

    public ensureRowHeightsValid(): boolean {
        return this.innerRowModel.ensureRowHeightsValid();
    }

    public getPinnedTopTotalHeight(): number {
        return this.innerRowModel.getTotalHeight('top');
    }

    public getPinnedBottomTotalHeight(): number {
        return this.innerRowModel.getTotalHeight('bottom');
    }

    public getPinnedTopRowCount(): number {
        return this.innerRowModel.getRowCount('top');
    }

    public getPinnedBottomRowCount(): number {
        return this.innerRowModel.getRowCount('bottom');
    }

    public getPinnedTopRow(index: number): RowNode | undefined {
        return this.innerRowModel.getRowByIndex(index, 'top');
    }

    public getPinnedBottomRow(index: number): RowNode | undefined {
        return this.innerRowModel.getRowByIndex(index, 'bottom');
    }

    public getPinnedRowById(id: string, floating: NonNullable<RowPinnedType>): RowNode | undefined {
        return this.innerRowModel.getRowById(id, floating);
    }

    public forEachPinnedRow(
        floating: NonNullable<RowPinnedType>,
        callback: (node: RowNode, index: number) => void
    ): void {
        return this.innerRowModel.forEachRow(floating, callback);
    }

    public pinRow(node: RowNode, floating: NonNullable<RowPinnedType>): void {
        return this.innerRowModel.pinRow(node, floating);
    }

    public unpinRow(node: RowNode, floating?: NonNullable<RowPinnedType>): void {
        const isTop = !!this.innerRowModel.getRowById(node.id!, 'top');
        if (isTop) {
            floating ??= 'top';
        }

        const isBottom = !!this.innerRowModel.getRowById(node.id!, 'bottom');
        if (isBottom) {
            floating ??= 'bottom';
        }

        if (floating) {
            this.innerRowModel.unpinRow(node, floating);
        }
    }
}

/**
 * Cache that maintains record of insertion order
 *
 * Allows lookup by key as well as insertion order (which is why we didn't use Map)
 */
interface OrderedCache<T> {
    cache: Partial<Record<string, T>>;
    order: string[];
}

function getById<T>(cache: OrderedCache<T>, id: string): T | undefined {
    return cache.cache[id];
}

function getByIndex<T>(cache: OrderedCache<T>, i: number): T | undefined {
    return getById(cache, cache.order[i]);
}

function forEach<T>(cache: OrderedCache<T>, callback: (item: T, index: number) => void): void {
    cache.order.forEach((id, index) => {
        const node = getById(cache, id);
        node && callback(node, index);
    });
}

function getSize<T>(cache: OrderedCache<T>): number {
    return cache.order.length;
}

function createCache<T>(): OrderedCache<T> {
    return {
        cache: {},
        order: [],
    };
}

function setValue<T>(cache: OrderedCache<T>, key: string, value: T): void {
    cache.cache[key] = value;
    cache.order.push(key);
}

function clearValue<T>(cache: OrderedCache<T>, key: string): T | undefined {
    const value = cache.cache[key];
    delete cache.cache[key];
    _removeFromArray(cache.order, key);
    return value;
}

function getTotalHeight(rowNodes: OrderedCache<RowNode>): number {
    const size = getSize(rowNodes);
    if (size === 0) {
        return 0;
    }

    const node = getByIndex(rowNodes, size - 1);
    if (node === undefined) {
        return 0;
    }

    return node.rowTop! + node.rowHeight!;
}

function setRowTopAndRowIndex(beans: BeanCollection, rowNode: RowNode, rowTop: number, rowIndex?: number): number {
    rowNode.setRowTop(rowTop);
    rowNode.setRowHeight(_getRowHeightForNode(beans, rowNode).height);
    if (rowIndex !== undefined) {
        rowNode.setRowIndex(rowIndex);
    }
    return rowNode.rowHeight!;
}
