/** Desmos-style placeholder examples shown in GUI fields. */
export const FUNCTION_PLACEHOLDER_2D = 'sin^2(x)';
export const FUNCTION_PLACEHOLDER_3D = 'sin^2(x)+cos^2(y)';
export const FUNCTION_PLACEHOLDER_PDE = 'exp(-2*t)*sin(x)*sin(y)';
export const FUNCTION_PLACEHOLDER_ODE = 'exp(x)';

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
