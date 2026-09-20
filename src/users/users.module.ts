import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffUser } from './staff-user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([StaffUser])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
