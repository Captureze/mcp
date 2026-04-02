/**
 * Standard response returned by all controllers.
 */
export interface ControllerResponse {
  content: string;
}

/**
 * Pagination parameters used in list operations.
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
}
