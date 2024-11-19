export interface QuickNodeStreamData {
    signature: string;
    slot: number;
    blockTime: number;
    programInvocations: ProgramInvocation[];
    logs: string[];
    success: boolean;
}

export interface ProgramInvocation {
    programId: string;
    instruction: {
        index: number;
        accounts: AccountBalance[];
        data: any;
        tokenBalances: any;
    };
}

export interface AccountBalance {
    pubkey: string;
    preBalance: number;
    postBalance: number;
}