import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export const OPERATIONS = ["EXPLORE", "ANALYZE", "VISUALIZE", "TRAIN"] as const;
export type Operation = (typeof OPERATIONS)[number];

export class RepairDto {
  @IsArray()
  @ArrayMinSize(1, { message: "Select at least one repair." })
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  actions!: string[];

  @IsOptional()
  @IsObject()
  methods?: Record<string, string>;
}

export class UploadDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

/**
 * Run an analysis operation. `params` is validated in depth by the Python
 * engine (column names and kinds depend on the data); see docs/api-contract.md.
 */
export class OperationDto {
  @IsIn(OPERATIONS)
  operation!: Operation;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}
