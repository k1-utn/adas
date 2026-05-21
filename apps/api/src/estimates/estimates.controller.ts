import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { decodeVinRequestSchema, acknowledgeRequestSchema } from '@adas/shared';
import { AuthGuard, RolesGuard, Roles, CurrentUser, type Principal } from '../auth/auth.guard.js';
import { AuditService } from '../audit/audit.service.js';
import { VinService } from '../vin/vin.service.js';
import { EstimatesService } from './estimates.service.js';
import { ReportService } from '../reports/report.service.js';

const EMS_EXTENSIONS = ['.ems', '.txt', '.cif', '.est'];
const BMS_EXTENSIONS = ['.xml', '.bms'];

function isAcceptedEstimateFile(file: { originalname: string; mimetype: string }): boolean {
  const name = file.originalname.toLowerCase();
  if (file.mimetype === 'application/pdf' || name.endsWith('.pdf')) return true;
  if (EMS_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  if (BMS_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  // Some platforms upload EMS files with octet-stream / plain text mime types — accept
  // when the extension is recognized rather than gating on mime alone.
  return false;
}

@Controller('vin')
@UseGuards(AuthGuard, RolesGuard)
export class VinController {
  constructor(
    private readonly vin: VinService,
    private readonly audit: AuditService,
  ) {}

  @Post('decode')
  async decode(@CurrentUser() user: Principal, @Body() body: unknown) {
    const { vin } = decodeVinRequestSchema.parse(body);
    const profile = await this.vin.decode(vin);
    await this.audit.record(user, 'vin.decode', { type: 'VinRecord', id: vin });
    return profile;
  }
}

@Controller('estimates')
@UseGuards(AuthGuard, RolesGuard)
export class EstimatesController {
  constructor(
    private readonly estimates: EstimatesService,
    private readonly audit: AuditService,
    private readonly reports: ReportService,
  ) {}

  @Post()
  @Roles('OWNER', 'MANAGER', 'ESTIMATOR')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: Principal,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    @Body('shopId') shopId?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!isAcceptedEstimateFile(file)) {
      throw new BadRequestException(
        'Unsupported file. Accepts PDF estimates and CIECA EMS exports (.ems/.txt) ' +
          'or CIECA BMS XML exports from CCC, Mitchell, and Audatex.',
      );
    }
    // In production: stream buffer to S3-compatible storage and use the returned key.
    const key = `uploads/${user.organizationId}/${Date.now()}-${file.originalname}`;
    const result = await this.estimates.createFromUpload(
      user,
      { key, originalName: file.originalname },
      shopId,
    );
    await this.audit.record(user, 'estimate.upload', { type: 'Estimate', id: result.id });
    return result;
  }

  @Get(':id')
  async getOne(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.estimates.getById(user, id);
  }

  @Get(':id/requirements')
  async requirements(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.estimates.getRequirements(user, id);
  }

  @Post(':id/acknowledge')
  async acknowledge(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { statement } = acknowledgeRequestSchema.parse(body);
    const ack = await this.estimates.acknowledge(user, id, statement);
    await this.audit.record(user, 'estimate.acknowledge', { type: 'Estimate', id });
    return ack;
  }

  @Get(':id/report')
  async report(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.reports.generate(user, id);
    await this.audit.record(user, 'report.generate', { type: 'Estimate', id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="adas-report-${id}.pdf"`);
    res.end(pdf);
  }
}
