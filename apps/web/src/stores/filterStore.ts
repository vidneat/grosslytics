import { atom } from 'nanostores';
import type { DashboardFilterState } from '@grosslytics/shared/types';

export const $dashboardFilters = atom<DashboardFilterState>({
	dateRange: '30d',
	attributionModel: 'first',
	revenueMode: 'net',
});

export function setDateRange(range: DashboardFilterState['dateRange']): void {
	$dashboardFilters.set({ ...$dashboardFilters.get(), dateRange: range });
}

export function setAttributionModel(model: DashboardFilterState['attributionModel']): void {
	$dashboardFilters.set({ ...$dashboardFilters.get(), attributionModel: model });
}

export function setRevenueMode(mode: DashboardFilterState['revenueMode']): void {
	$dashboardFilters.set({ ...$dashboardFilters.get(), revenueMode: mode });
}

