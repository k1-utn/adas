import { Injectable, Logger } from '@nestjs/common';
import { vinSchema, type VinProfile, type AdasSystem } from '@adas/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * VIN Decoder. Decodes via NHTSA vPIC (free, public) for make/model/year/trim, then infers
 * a candidate ADAS profile. NOTE: NHTSA does not return per-vehicle ADAS equipment, so the
 * ADAS profile is a *candidate* inferred from model/year heuristics and is explicitly marked
 * advisory — a production system layers OEM build-data APIs on top. Results are cached in
 * VinRecord so repeat lookups are free.
 */
@Injectable()
export class VinService {
  private readonly logger = new Logger(VinService.name);
  constructor(private readonly prisma: PrismaService) {}

  async decode(rawVin: string): Promise<VinProfile> {
    const vin = vinSchema.parse(rawVin);

    const cached = await this.prisma.vinRecord.findUnique({ where: { vin } });
    if (cached) return this.toProfile(cached);

    const decoded = await this.callNhtsa(vin);
    const adasSystems = this.inferAdas(decoded);

    const record = await this.prisma.vinRecord.create({
      data: {
        vin,
        make: decoded.make,
        model: decoded.model,
        trim: decoded.trim,
        modelYear: decoded.modelYear,
        adasSystems: adasSystems as object,
        decodedBy: 'nhtsa',
      },
    });
    return this.toProfile(record);
  }

  private async callNhtsa(vin: string): Promise<{
    make: string | null;
    model: string | null;
    trim: string | null;
    modelYear: number | null;
  }> {
    try {
      const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`;
      const res = await fetch(url);
      const json = (await res.json()) as { Results?: Array<Record<string, string>> };
      const r = json.Results?.[0] ?? {};
      return {
        make: r.Make || null,
        model: r.Model || null,
        trim: r.Trim || r.Series || null,
        modelYear: r.ModelYear ? Number(r.ModelYear) : null,
      };
    } catch (e) {
      this.logger.warn(`NHTSA decode failed for ${vin}: ${String(e)}`);
      return { make: null, model: null, trim: null, modelYear: null };
    }
  }

  /**
   * Candidate ADAS inference. Deliberately conservative. This is advisory input to the rules
   * engine, not ground truth — the rules engine + human verification gate the final output.
   */
  private inferAdas(d: { make: string | null; modelYear: number | null }): {
    system: AdasSystem;
    sensors: string[];
  }[] {
    const systems: { system: AdasSystem; sensors: string[] }[] = [];
    const year = d.modelYear ?? 0;
    // Forward camera/radar (ADAS) became broadly common on many models ~2018+.
    if (year >= 2018) {
      systems.push({ system: 'front_camera', sensors: ['windshield_camera'] });
      systems.push({ system: 'front_radar', sensors: ['front_radar'] });
      systems.push({ system: 'lkas_camera', sensors: ['windshield_camera'] });
    }
    if (year >= 2019) {
      systems.push({ system: 'blind_spot_radar', sensors: ['rear_corner_radar'] });
    }
    return systems;
  }

  private toProfile(r: {
    vin: string;
    make: string | null;
    model: string | null;
    trim: string | null;
    modelYear: number | null;
    adasSystems: unknown;
  }): VinProfile {
    return {
      vin: r.vin,
      make: r.make,
      model: r.model,
      trim: r.trim,
      modelYear: r.modelYear,
      adasSystems: (r.adasSystems as VinProfile['adasSystems']) ?? [],
    };
  }
}
