export interface ActivityItem {readonly id:string;readonly title:string;readonly when:string}
export interface DashboardSnapshot {
  readonly metrics:{readonly openRequests:number;readonly completed:number;readonly responseMinutes:number};
  readonly activity:readonly ActivityItem[];
}
export interface DashboardRepository {read(signal:AbortSignal):Promise<DashboardSnapshot>}
