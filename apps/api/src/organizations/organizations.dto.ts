import { Transform } from "class-transformer";
import { IsEmail, IsIn, IsString, Length, MaxLength } from "class-validator";

export class UpdateOrganizationDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(2, 160)
  name!: string;
}

export class InviteDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsIn(["ADMIN", "MEMBER"])
  role!: "ADMIN" | "MEMBER";
}

export class UpdateMemberDto {
  @IsIn(["ADMIN", "MEMBER"])
  role!: "ADMIN" | "MEMBER";
}
