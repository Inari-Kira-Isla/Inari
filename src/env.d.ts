/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    userId: string;
    userType: string;
    userRole: string;
    username: string;
    customerCode: string;
    isStaff: boolean;
  }
}
