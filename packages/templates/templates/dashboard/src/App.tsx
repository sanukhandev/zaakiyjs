import {createDashboardPage} from "./features/dashboard/adapters/createDashboardPage";
import {createDemoDashboardRepository} from "./features/dashboard/services/dashboardRepository";
import {DashboardView} from "./features/dashboard/views/DashboardView";
export function App(){
  const vm=createDashboardPage(createDemoDashboardRepository());
  return <DashboardView vm={vm}/>;
}
