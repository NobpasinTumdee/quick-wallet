import { api } from '../../api/client';
import type { PlanningData } from '../../types/planning';
import type { PlanningAction, PlanningTransport } from './store';

/** The store's calls, as the REST paths the client resolves to Planning's actions. */
export const planningTransport: PlanningTransport = {
  list: (options) => api.get<PlanningData>('/api/planProjects', options?.includeArchived ? { includeArchived: true } : undefined),
  call(action: PlanningAction, body: Record<string, unknown>) {
    const { id, ...rest } = body as { id?: string } & Record<string, unknown>;
    switch (action) {
      case 'project.save':
        return api.put('/api/planProjects', body);
      case 'project.delete':
        return api.delete(`/api/planProjects/${encodeURIComponent(String(id))}`, undefined, rest);
      case 'status.save':
        return api.put('/api/planStatuses', body);
      case 'status.reorder':
        return api.post('/api/planStatuses/reorder', body);
      case 'status.delete':
        return api.delete(`/api/planStatuses/${encodeURIComponent(String(id))}`, undefined, rest);
      case 'item.save':
        return api.put('/api/planItems', body);
      case 'item.move':
        return api.post(`/api/planItems/${encodeURIComponent(String(id))}/move`, rest);
      case 'item.archive':
        return api.post(`/api/planItems/${encodeURIComponent(String(id))}/archive`, rest);
      case 'milestone.save':
        return api.put('/api/planMilestones', body);
      case 'milestone.delete':
        return api.delete(`/api/planMilestones/${encodeURIComponent(String(id))}`, undefined, rest);
      case 'item.delete':
        return api.delete(`/api/planItems/${encodeURIComponent(String(id))}`, undefined, rest);
      default:
        return Promise.reject(new Error(`Unknown planning action ${action as string}`));
    }
  },
};
