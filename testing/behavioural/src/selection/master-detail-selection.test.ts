import type { MockInstance } from 'vitest';

import type { GetRowIdParams, GridApi, GridOptions } from 'ag-grid-community';
import { ClientSideRowModelModule } from 'ag-grid-community';
import { RowGroupingModule, ServerSideRowModelModule } from 'ag-grid-enterprise';

import { TestGridsManager } from '../test-utils';
import { fakeFetch } from './data';
import {
    assertSelectedRowElementsById,
    assertSelectedRowsByIndex,
    clickRowByIndex,
    expandGroupRowByIndex,
    selectRowsByIndex,
    toggleCheckboxByIndex,
    toggleHeaderCheckboxByIndex,
    waitForEvent,
} from './utils';

describe('Row Selection Grid Options', () => {
    const columnDefs = [{ field: 'sport' }];
    const rowData = [
        { sport: 'football' },
        { sport: 'rugby' },
        { sport: 'tennis' },
        { sport: 'cricket' },
        { sport: 'golf' },
        { sport: 'swimming' },
        { sport: 'rowing' },
    ];
    let consoleErrorSpy: MockInstance;
    let consoleWarnSpy: MockInstance;

    function createGrid(gridOptions: GridOptions): GridApi {
        return gridMgr.createGrid('myGrid', gridOptions);
    }

    async function createGridAndWait(gridOptions: GridOptions): Promise<GridApi> {
        const api = createGrid(gridOptions);

        await waitForEvent('firstDataRendered', api);

        return api;
    }

    const gridMgr = new TestGridsManager({
        modules: [ClientSideRowModelModule, RowGroupingModule, ServerSideRowModelModule],
    });

    beforeEach(() => {
        gridMgr.reset();

        consoleErrorSpy = vitest.spyOn(console, 'error').mockImplementation(() => {});
        consoleWarnSpy = vitest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        gridMgr.reset();

        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    test.skip('selecting master row will select all rows in detail grid', () => {});
    test.skip('selecting row in detail grid applies indeterminate state to master row', () => {});
    test.skip('selecting master row warns when detail grid has single row selection configured', () => {});
    test.skip('selecting master row warns when detail grid has selection disabled', () => {});
    test.skip('selecting master row propagates selection to all nested detail grids when configured', () => {});
    test.skip('de-selecting leaf-level detail row propagates indeterminate state to all ');
});
