// TypeScript interfaces for Extension Publisher Backend API (/v1/publish-server)

export interface ServerDetailPayload {
  id?: string;
  name: string; // e.g., io.github.owner/repo - This is required
  description?: string;
  version_detail?: VersionDetail;
  registries?: Registry[]; // Changed from 'Registries' to 'Registry' for singular array item
  remotes?: Remote[];     // Changed from 'Remotes' to 'Remote' for singular array item
}

export interface VersionDetail {
  version?: string;
  release_date?: string; // RFC 3339 date format
  is_latest?: boolean;
}

export interface Registry { // Singular form for array elements
  name?: string;
  package_name?: string;
  license?: string;
  command_arguments?: CommandArguments;
}

export interface Remote { // Singular form for array elements
  transport_type?: string;
  url?: string;
}

export interface CommandArguments {
  sub_commands?: SubCommand[];
  positional_arguments?: PositionalArgument[];
  environment_variables?: EnvironmentVariable[];
  named_arguments?: NamedArgument[];
}

export interface EnvironmentVariable {
  name?: string;
  description?: string;
  required?: boolean;
}

export interface Argument {
  name?: string;
  description?: string;
  default_value?: string;
  is_required?: boolean;
  is_editable?: boolean;
  is_repeatable?: boolean;
  choices?: string[];
}

export interface PositionalArgument {
  position?: number;
  argument?: Argument;
}

export interface SubCommand {
  name?: string;
  description?: string;
  named_arguments?: NamedArgument[];
}

export interface NamedArgument {
  short_flag?: string;
  long_flag?: string;
  requires_value?: boolean;
  argument?: Argument;
}

