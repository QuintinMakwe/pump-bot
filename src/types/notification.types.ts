export enum NotificationType {
    ENTRY_SIGNAL = 'ENTRY_SIGNAL',
    EXIT_SIGNAL = 'EXIT_SIGNAL',
    MONITORING_STARTED = 'MONITORING_STARTED',
    MONITORING_STOPPED = 'MONITORING_STOPPED'
}

export interface NotificationPayload {
    type: NotificationType;
    mintAddress: string;
    timestamp: number;
    data: any;
}