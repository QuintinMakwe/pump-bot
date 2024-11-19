import { QuickNodeStreamData } from "@src/types/quicknode.types";

export function isQuickNodeStreamData(data: any): data is QuickNodeStreamData[] {
    console.log('Validating QuickNode stream data:', data.length);
    if (!Array.isArray(data)) return false;

    return data.every(tx => 
        typeof tx.signature === 'string' &&
        typeof tx.slot === 'number' &&
        typeof tx.blockTime === 'number' &&
        Array.isArray(tx.programInvocations) &&
        Array.isArray(tx.logs) &&
        typeof tx.success === 'boolean'
    );
}