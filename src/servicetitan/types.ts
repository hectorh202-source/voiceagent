export interface STContact {
  type: string;
  value: string;
}

export interface STAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface STCustomer {
  id: number;
  name?: string;
  address?: STAddress;
  contacts?: STContact[];
}
