import { Transform } from "class-transformer";
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class ReasonDto {
  @Transform(trim)
  @IsString()
  @Length(5, 500, { message: "Give a reason of at least 5 characters." })
  reason!: string;
}

export class GrantTrialDto extends ReasonDto {
  @IsInt()
  @Min(1)
  @Max(90)
  days!: number;
}

export class ActivateSubscriptionDto extends ReasonDto {
  @IsString()
  @Length(1, 40)
  planCode!: string;

  @IsInt()
  @Min(1)
  @Max(24)
  months!: number;
}

export class UpdatePlanDto extends ReasonDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  priceMinor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  providerPlanCode?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsObject()
  limits?: Record<string, number>;
}
