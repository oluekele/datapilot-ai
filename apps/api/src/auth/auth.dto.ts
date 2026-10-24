import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const email = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @IsIn(["INDIVIDUAL", "TEAM"])
  accountType!: "INDIVIDUAL" | "TEAM";

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  displayName!: string;

  @Transform(email)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(10, { message: "Password must be at least 10 characters." })
  @MaxLength(200)
  password!: string;

  @ValidateIf((o: RegisterDto) => o.accountType === "TEAM")
  @Transform(trim)
  @IsString()
  @Length(2, 160)
  organizationName?: string;
}

export class LoginDto {
  @Transform(email)
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}

export class EmailDto {
  @Transform(email)
  @IsEmail()
  email!: string;
}

export class TokenDto {
  @IsString()
  @Length(20, 100)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @MinLength(10, { message: "Password must be at least 10 characters." })
  @MaxLength(200)
  password!: string;
}

export class PasswordDto {
  @IsString()
  @MaxLength(200)
  password!: string;
}

export class SwitchOrganizationDto {
  @IsUUID()
  organizationId!: string;
}
