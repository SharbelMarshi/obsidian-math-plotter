/** Placeholder text is intentionally blank: new graphs should not seed sample math. */
export const FUNCTION_PLACEHOLDER_2D = '';
export const FUNCTION_PLACEHOLDER_3D = '';
export const FUNCTION_PLACEHOLDER_PDE = '';
export const FUNCTION_PLACEHOLDER_ODE = '';

export function placeholderForGraphType(type: string): string {
	switch (type) {
		case 'surface3d':
			return FUNCTION_PLACEHOLDER_3D;
		case 'pde':
			return FUNCTION_PLACEHOLDER_PDE;
		case 'ode':
			return FUNCTION_PLACEHOLDER_ODE;
		default:
			return FUNCTION_PLACEHOLDER_2D;
	}
}
