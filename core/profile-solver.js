/**
 * Profile Solver for Seating Bowl Generator.
 * Calculates C-value driven seating bowl profiles.
 * Ported from profile_solver.py
 *
 * C-Value Formula:
 *     C = D * (N + R) / (D + T) - N
 *
 * Where:
 *     D = Horizontal distance from eye to focal point
 *     N = Eye height above focal point
 *     R = Riser height of row ahead
 *     T = Row depth (tread)
 *     C = C-value (sightline clearance)
 *
 * Rearranged to solve for R (riser height):
 *     R = (C + N) * (D + T) / D - N
 */

export function getSolverTierIndex(solver, fallbackIndex = 0) {
    const tierIndex = Number(solver?.tierIndex);
    return Number.isInteger(tierIndex) ? tierIndex : fallbackIndex;
}

function normalizeStructuralProfileMode(structuralProfileMode) {
    return structuralProfileMode === 'sloped' ? 'sloped' : 'stepped';
}

function dedupeProfilePoints(points, epsilon = 1e-6) {
    if (!Array.isArray(points) || points.length === 0) return [];

    const deduped = [];
    for (const point of points) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) continue;
        const lastPoint = deduped[deduped.length - 1];
        if (
            !lastPoint ||
            Math.abs(lastPoint.x - point.x) > epsilon ||
            Math.abs(lastPoint.z - point.z) > epsilon
        ) {
            deduped.push({
                x: point.x,
                z: point.z
            });
        }
    }

    return deduped;
}

function getStructuralFrontBaseZ(firstRow, tierIndex = 0, structuralDepthFt = 0) {
    if (!firstRow) return 0;
    if (tierIndex === 0) return 0;
    if (structuralDepthFt > 0) {
        return Math.max(0, firstRow.z - structuralDepthFt);
    }
    return firstRow.z - firstRow.riser_height;
}

function buildStructuralTopProfile(solver, tierIndex = 0, structuralDepthFt = 0) {
    if (!solver?.rows?.length) return [];

    const firstRow = solver.rows[0];
    const startX = firstRow.x - solver.treadDepthFt;
    const baseZ = getStructuralFrontBaseZ(firstRow, tierIndex, structuralDepthFt);
    const topProfile = [
        { x: startX, z: baseZ },
        { x: startX, z: firstRow.z }
    ];
    const segments = typeof solver.getStepGeometry === 'function'
        ? solver.getStepGeometry()
        : [];

    for (const [start, end] of segments) {
        topProfile.push(start, end);
    }

    return dedupeProfilePoints(topProfile);
}

function buildSteppedUndersideProfile(solver, rows, lastRowX, structuralDepthFt, frontBottomZ) {
    const undersideProfile = [{
        x: Math.min(lastRowX, (rows[0].x - solver.treadDepthFt) + structuralDepthFt),
        z: frontBottomZ
    }];

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const treadStartX = Math.min(lastRowX, (row.x - solver.treadDepthFt) + structuralDepthFt);
        const treadEndX = index < rows.length - 1
            ? Math.min(lastRowX, row.x + structuralDepthFt)
            : lastRowX;
        const rowBottomZ = Math.max(0, row.z - structuralDepthFt);

        undersideProfile.push({ x: treadStartX, z: rowBottomZ });
        undersideProfile.push({ x: treadEndX, z: rowBottomZ });

        if (index < rows.length - 1) {
            const nextRow = rows[index + 1];
            undersideProfile.push({
                x: treadEndX,
                z: Math.max(0, nextRow.z - structuralDepthFt)
            });
        }
    }

    return dedupeProfilePoints(undersideProfile);
}

export function buildStructuralProfileGeometry(
    solver,
    { structuralDepthFt = 0, structuralProfileMode = 'stepped', tierIndex = 0 } = {}
) {
    if (!solver?.rows?.length) return null;

    const rows = solver.rows;
    const resolvedTierIndex = getSolverTierIndex(solver, tierIndex);
    const depthFt = Math.max(0, Number(structuralDepthFt) || 0);
    const mode = normalizeStructuralProfileMode(structuralProfileMode);
    const topProfile = buildStructuralTopProfile(solver, resolvedTierIndex, depthFt);
    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    const startX = firstRow.x - solver.treadDepthFt;
    const baseZ = getStructuralFrontBaseZ(firstRow, resolvedTierIndex, depthFt);
    const frontBottomZ = Math.max(0, resolvedTierIndex === 0 ? 0 : (firstRow.z - depthFt));

    let undersideProfile = [];
    if (depthFt > 0) {
        undersideProfile = mode === 'sloped'
            ? dedupeProfilePoints([
                {
                    x: Math.min(lastRow.x, startX + depthFt),
                    z: frontBottomZ
                },
                {
                    x: lastRow.x,
                    z: Math.max(0, lastRow.z - depthFt)
                }
            ])
            : buildSteppedUndersideProfile(solver, rows, lastRow.x, depthFt, frontBottomZ);
    }

    const closedProfile = [...topProfile];
    if (undersideProfile.length > 0) {
        const topEnd = topProfile[topProfile.length - 1];
        const rearBottom = undersideProfile[undersideProfile.length - 1];
        closedProfile.push({ x: topEnd.x, z: rearBottom.z });
        for (let index = undersideProfile.length - 1; index >= 0; index -= 1) {
            closedProfile.push(undersideProfile[index]);
        }
        closedProfile.push({ x: startX, z: frontBottomZ });
        closedProfile.push({ x: startX, z: baseZ });
    }

    const boundsPoints = [
        ...topProfile,
        ...undersideProfile,
        { x: startX, z: frontBottomZ }
    ];
    const bounds = boundsPoints.reduce((accumulator, point) => ({
        minX: Math.min(accumulator.minX, point.x),
        maxX: Math.max(accumulator.maxX, point.x),
        minZ: Math.min(accumulator.minZ, point.z),
        maxZ: Math.max(accumulator.maxZ, point.z)
    }), {
        minX: startX,
        maxX: lastRow.x,
        minZ: Math.min(baseZ, frontBottomZ),
        maxZ: Math.max(baseZ, lastRow.z)
    });

    return {
        topProfile,
        undersideProfile,
        closedProfile: dedupeProfilePoints(closedProfile),
        bounds
    };
}

export function buildActiveTierSolvers(tiers, focalPointFt) {
    const solvers = [];

    (tiers || []).forEach((tierState, tierIndex) => {
        if (!tierState?.enabled) return;

        const solver = new ProfileSolver({
            targetCValue: tierState.cValue,
            firstRowDistance: tierState.firstRowDist,
            firstRowElevation: tierState.firstRowElev,
            treadDepth: tierState.treadDepth,
            defaultRiser: tierState.riserHeight,
            numRows: Math.round(tierState.numRows),
            eyeHeight: tierState.eyeHeight,
            eyeSetback: tierState.eyeSetback,
            focalX: focalPointFt?.x,
            focalZ: focalPointFt?.z
        });
        solver.solve(tierState.profileType);
        solver.tierIndex = tierIndex;
        solvers.push(solver);
    });

    return solvers;
}

export function buildNextTierDefaultsFromSolvers(solvers, tierNum) {
    if (tierNum <= 1 || solvers.length < tierNum - 1) return null;

    const prevTier = solvers[tierNum - 2];
    if (!prevTier?.rows?.length) return null;

    const lastRow = prevTier.rows[prevTier.rows.length - 1];
    return {
        firstRowDist: Math.round(lastRow.x),
        firstRowElev: Math.round(lastRow.z + 15),
        riserHeight: 12
    };
}

export function buildNextTierDefaultsFromTiers(tiers, focalPointFt, tierNum) {
    return buildNextTierDefaultsFromSolvers(
        buildActiveTierSolvers(tiers, focalPointFt),
        tierNum
    );
}

export function buildTierMetricsByIndex({
    solvers,
    bowlConfig,
    egressParams,
    offsetCorrection = 0,
    calculateRowLength
}) {
    const tierMetricsByIndex = new Map();
    if (typeof calculateRowLength !== 'function') return tierMetricsByIndex;

    const rowLengthAdapter = {
        calculateRowLength(nextBowlConfig, offset) {
            return calculateRowLength(nextBowlConfig, offset);
        }
    };

    (solvers || []).forEach((solver, index) => {
        if (!solver?.rows?.length) return;

        const tierIndex = getSolverTierIndex(solver, index);
        const metrics = ProfileSolver.calculateTierMetrics(
            solver,
            bowlConfig,
            rowLengthAdapter,
            egressParams,
            offsetCorrection
        );
        if (!metrics) return;

        tierMetricsByIndex.set(tierIndex, metrics);
    });

    return tierMetricsByIndex;
}

export class RowData {
    constructor(rowNumber) {
        this.row_number = rowNumber;
        this.x = 0.0;            // Horizontal position (distance from focal)
        this.z = 0.0;            // Elevation
        this.riser_height = 0.0;
        this.tread_depth = 0.0;
        this.eye_x = 0.0;        // Eye horizontal position
        this.eye_z = 0.0;        // Eye elevation
        this.c_value = 0.0;      // Achieved C-value
        this.sightline_angle = 0.0; // Angle to focal point
    }
}

export class ProfileSolver {
    /**
     * @param {Object} params
     * @param {number} params.targetCValue - Target C-value in inches
     * @param {number} params.firstRowDistance - Distance from focal point to first row (ft)
     * @param {number} params.firstRowElevation - Elevation of first row above focal (ft)
     * @param {number} params.treadDepth - Row depth/tread (inches)
     * @param {number} params.defaultRiser - Starting riser height (inches)
     * @param {number} params.numRows - Number of seating rows
     * @param {number} params.eyeHeight - Eye height above seat surface (ft)
     * @param {number} params.eyeSetback - Eye distance from riser (inches)
     * @param {number} [params.focalX=0] - Focal point X coordinate (ft)
     * @param {number} [params.focalZ=0] - Focal point Z coordinate (ft)
     */
    constructor(params) {
        this.targetCValue = params.targetCValue;         // inches
        this.firstRowDistance = params.firstRowDistance;   // ft
        this.firstRowElevation = params.firstRowElevation; // ft
        this.treadDepth = params.treadDepth;               // inches
        this.defaultRiser = params.defaultRiser;           // inches
        this.numRows = params.numRows;
        this.eyeHeight = params.eyeHeight;                 // ft
        this.eyeSetback = params.eyeSetback;               // inches
        this.focalX = params.focalX || 0.0;                // ft
        this.focalZ = params.focalZ || 0.0;                // ft

        // Convert to consistent units (feet for geometry)
        this.treadDepthFt = this.treadDepth / 12.0;
        this.eyeSetbackFt = this.eyeSetback / 12.0;
        this.targetCFt = this.targetCValue / 12.0;

        this.rows = [];
        this.tierIndex = 0;
        this.tierBreakRow = 0;
    }

    /**
     * Solve for the complete profile.
     * @param {string} method - "Parabolic" or "Linear"
     * @returns {RowData[]}
     */
    solve(method = "Parabolic") {
        if (method === "Linear") {
            return this._solveLinear();
        }
        return this._solveParabolic();
    }

    _solveParabolic() {
        this.rows = [];

        for (let i = 0; i < this.numRows; i++) {
            const row = new RowData(i + 1);

            if (i === 0) {
                row.x = this.firstRowDistance + this.treadDepthFt;
                row.z = this.firstRowElevation;
                row.riser_height = this.defaultRiser / 12.0;
                row.tread_depth = this.treadDepthFt;
            } else {
                const prevRow = this.rows[i - 1];
                row.x = prevRow.x + this.treadDepthFt;
                row.tread_depth = this.treadDepthFt;
                row.riser_height = this._calculateRiser(prevRow, row.x);
                row.z = prevRow.z + row.riser_height;
            }

            this._finalizeRow(row, i > 0 ? this.rows[i - 1] : null);
            this.rows.push(row);
        }

        return this.rows;
    }

    _solveLinear() {
        this.rows = [];

        // STRICTLY use the default riser (Starting Riser Height)
        // No iteration, no auto-adjustment to meet C-values.
        const fixedRiser = this.defaultRiser / 12.0;
        let prev = null;

        for (let i = 0; i < this.numRows; i++) {
            const row = new RowData(i + 1);

            if (i === 0) {
                row.x = this.firstRowDistance + this.treadDepthFt;
                row.z = this.firstRowElevation;
                row.riser_height = fixedRiser;
                row.tread_depth = this.treadDepthFt;
            } else {
                row.x = prev.x + this.treadDepthFt;
                row.tread_depth = this.treadDepthFt;
                row.riser_height = fixedRiser;
                row.z = prev.z + row.riser_height;
            }

            this._finalizeRow(row, i > 0 ? prev : null);
            this.rows.push(row);
            prev = row;
        }

        return this.rows;
    }

    _finalizeRow(row, prevRow = null) {
        row.eye_x = row.x - this.eyeSetbackFt;
        row.eye_z = row.z + this.eyeHeight;
        row.c_value = this._calculateCValue(row, prevRow);

        const dx = row.eye_x - this.focalX;
        const dz = row.eye_z - this.focalZ;
        row.sightline_angle = (Math.atan2(dz, dx) * 180) / Math.PI;
    }

    _calculateRiser(prevRow, currentX) {
        const DCurr = currentX - this.eyeSetbackFt - this.focalX;
        const DPrev = prevRow.eye_x - this.focalX;
        const N = prevRow.eye_z - this.focalZ;
        const C = this.targetCFt;

        let R;
        if (DPrev > 0) {
            R = (C + N) * (DCurr / DPrev) - N;
        } else {
            R = this.defaultRiser / 12.0;
        }

        const minRiser = 4.0 / 12.0;
        const maxRiser = 22.0 / 12.0;

        return Math.max(minRiser, Math.min(R, maxRiser));
    }

    _calculateCValue(row, prevRow = null) {
        if (row.row_number === 1 || prevRow === null) {
            const D = row.eye_x - this.focalX;
            if (D > 0) {
                return (row.eye_z - this.focalZ) * 12.0; // Return in inches
            }
            return 0;
        }

        const DCurr = row.eye_x - this.focalX;
        const DPrev = prevRow.eye_x - this.focalX;
        const N = prevRow.eye_z - this.focalZ;

        const HCurr = N + row.riser_height;

        if (DCurr > 0) {
            const ZAtObst = HCurr * (DPrev / DCurr);
            const C = ZAtObst - N;
            return C * 12.0; // Return in inches
        }
        return 0;
    }

    static calculateTierMetrics(solver, bowlConfig, fieldRenderer, params, offsetCorrection = 0) {
        const {
            seatWidthIn = 20,
            maxAisleWidthIn = 72,
            minAisleWidthIn = 48,
            egressFactor = 0.2,
            seatsBetweenAisles = 20
        } = params;

        if (!solver || !solver.rows || solver.rows.length === 0) return null;

        const numRows = solver.rows.length;
        const bowlType = String(bowlConfig && bowlConfig.type ? bowlConfig.type : '').toLowerCase();
        const mirroredSideRuns = bowlType === 'sides' ? 2 : 1;

        // 1. Calculate Average Tier Length and Back Row Length
        let totalRawLengthIn = 0;
        let backRowLengthIn = 0;
        solver.rows.forEach((row, index) => {
            const offset = (row.x - row.tread_depth) - offsetCorrection;
            const lengthFt = fieldRenderer.calculateRowLength(bowlConfig, offset);
            const lengthIn = lengthFt * 12.0;
            totalRawLengthIn += lengthIn;
            if (index === numRows - 1) {
                backRowLengthIn = lengthIn;
            }
        });
        const AvgTierLengthIn = (totalRawLengthIn / numRows) / mirroredSideRuns;
        const BackRowLengthForEgressIn = backRowLengthIn / mirroredSideRuns;

        // 2. Iterative loop for aisle sizing (Option 1: uniform max width)
        // Use the back row (widest row) as the hard cap check for max seats/row.
        let iterAisleLines = 2; // Start with minimum edge aisles
        let iterAisleWidth = minAisleWidthIn;
        let finalSeatsPerRow = 0; // Average-row proxy (used for occupancy estimates/UI summary)
        let finalBackRowSeatsPerRow = 0; // Hard-limit row for seatsBetweenAisles
        let BlocksPerRow = 1;
        let converged = false;

        const maxIters = 20;
        for (let i = 0; i < maxIters; i++) {
            let totalAisleWidth = iterAisleLines * iterAisleWidth;

            // Average row proxy for overall tier volume / occupant load estimates.
            let avgSeatingLength = AvgTierLengthIn - totalAisleWidth;
            if (avgSeatingLength < 0) avgSeatingLength = 0;
            let avgSeatsPerRow = Math.floor(avgSeatingLength / seatWidthIn);
            if (avgSeatsPerRow < 0) avgSeatsPerRow = 0;

            // Back row governs the hard max-seats-between-aisles limit.
            let backSeatingLength = BackRowLengthForEgressIn - totalAisleWidth;
            if (backSeatingLength < 0) backSeatingLength = 0;
            let backSeatsPerRow = Math.floor(backSeatingLength / seatWidthIn);
            if (backSeatsPerRow < 0) backSeatsPerRow = 0;

            // Enforce block minimums based on the widest row, not the average row.
            let newBlocksPerRow = Math.ceil(backSeatsPerRow / seatsBetweenAisles);
            if (newBlocksPerRow < 1) newBlocksPerRow = 1;

            let SeatsInBlockPerRow = avgSeatsPerRow / newBlocksPerRow;
            let OccBlock = SeatsInBlockPerRow * numRows;

            // Tributary calculation (50/50 split)
            let maxOccAisle = (newBlocksPerRow === 1) ? (0.5 * OccBlock) : OccBlock;

            let Wcap_baseline = maxOccAisle * egressFactor;
            let Wreq_baseline = Math.max(Wcap_baseline, minAisleWidthIn);

            const newAisleWidth = Math.min(Wreq_baseline, maxAisleWidthIn);

            let Wcap = maxOccAisle * egressFactor;
            // If the required egress capacity exceeds the assigned width, we MUST add blocks (aisles)
            if (Wcap > newAisleWidth) {
                let maxOccAllowed = newAisleWidth / egressFactor;
                let requiredBlocks = Math.ceil((avgSeatsPerRow * numRows) / maxOccAllowed);
                if (requiredBlocks > newBlocksPerRow) {
                    newBlocksPerRow = requiredBlocks;
                }
            }

            let newAisleLines = newBlocksPerRow + 1; // n blocks have n+1 aisle lines

            if (
                newAisleLines === iterAisleLines &&
                Math.abs(newAisleWidth - iterAisleWidth) < 0.1 &&
                avgSeatsPerRow === finalSeatsPerRow &&
                backSeatsPerRow === finalBackRowSeatsPerRow &&
                newBlocksPerRow === BlocksPerRow
            ) {
                converged = true;
                break;
            }

            iterAisleLines = newAisleLines;
            iterAisleWidth = newAisleWidth;
            finalSeatsPerRow = avgSeatsPerRow;
            finalBackRowSeatsPerRow = backSeatsPerRow;
            BlocksPerRow = newBlocksPerRow;
        }

        // 3. Apply the converged aisle count and width per row to find final exact capacity
        let finalCapacity = 0;
        let finalSeatingLengthFt = 0;
        let finalAisleLengthFt = 0;
        let exactBackRowSeatsPerRow = 0;

        solver.rows.forEach((row, rowIndex) => {
            const offset = (row.x - row.tread_depth) - offsetCorrection;
            const lengthFt = fieldRenderer.calculateRowLength(bowlConfig, offset);
            const lengthIn = lengthFt * 12.0;

            const totalAisleWidthIn = iterAisleLines * iterAisleWidth;
            const rowEgressRunLengthIn = lengthIn / mirroredSideRuns;
            let usableIn = rowEgressRunLengthIn - totalAisleWidthIn;
            if (usableIn < 0) usableIn = 0;

            const rowCapacityPerRun = Math.floor(usableIn / seatWidthIn);
            const rowCapacity = rowCapacityPerRun * mirroredSideRuns;
            finalCapacity += rowCapacity;
            if (rowIndex === numRows - 1) exactBackRowSeatsPerRow = rowCapacityPerRun;

            // Store for UI display
            row.computedLength = lengthFt;
            row.computedSeats = rowCapacity;
            row.computedLengthPerSide = mirroredSideRuns > 1 ? (lengthIn / mirroredSideRuns) / 12.0 : lengthFt;
            row.computedSeatsPerSide = mirroredSideRuns > 1 ? rowCapacityPerRun : rowCapacity;
            row.computedBlocks = BlocksPerRow;

            // Linear Stats Accumulation
            // For mirrored "Sides" mode, report one representative side's egress math
            // in the egress card while keeping total capacity above.
            finalSeatingLengthFt += (usableIn / 12.0);
            finalAisleLengthFt += (totalAisleWidthIn / 12.0);
        });

        const totalEgressWidthRequired = iterAisleLines * iterAisleWidth;
        const SeatsInBlockPerRow = finalSeatsPerRow / BlocksPerRow;
        const OccBlock = SeatsInBlockPerRow * numRows;
        const maxOccAisle = (BlocksPerRow === 1) ? (0.5 * OccBlock) : OccBlock;
        const Wcap = maxOccAisle * egressFactor;

        let baselineBlocksPerRow = Math.ceil(exactBackRowSeatsPerRow / seatsBetweenAisles);
        if (baselineBlocksPerRow < 1) baselineBlocksPerRow = 1;

        return {
            capacity: finalCapacity,
            numAisles: iterAisleLines,
            aisleWidth: iterAisleWidth.toFixed(1),
            totalEgressWidthRequired: totalEgressWidthRequired.toFixed(1),
            totalRowLength: (finalSeatingLengthFt + finalAisleLengthFt).toFixed(0),
            totalSeatingLength: finalSeatingLengthFt.toFixed(0),
            totalAisleLength: finalAisleLengthFt.toFixed(0),
            seatsPerRow: finalSeatsPerRow,
            backRowSeatsPerRow: exactBackRowSeatsPerRow,
            numSections: BlocksPerRow,
            seatsPerBlock: SeatsInBlockPerRow.toFixed(1),
            occupantsPerSection: Math.round(OccBlock),
            occupantsPerAisleLine: Math.round(maxOccAisle),
            capacityWidth: Wcap.toFixed(1),
            minimumWidth: minAisleWidthIn.toFixed(1),
            maximumWidth: maxAisleWidthIn.toFixed(1),
            governingWidth: iterAisleWidth.toFixed(1),
            blocksAddedForEgress: BlocksPerRow - baselineBlocksPerRow,
            converged: converged,
            mirroredSideRuns
        };
    }

    /**
     * Calculate rows from occupant count.
     */
    static calculateRowsFromOccupants(params) {
        const {
            totalOccupants,
            seatWidthIn,
            seatingLengthFt,
            maxAisleWidthIn,
            minAisleWidthIn = 60.0,
            egressFactor = 0.3
        } = params;

        if (totalOccupants <= 0 || seatWidthIn <= 0 || seatingLengthFt <= 0) {
            return {
                numRows: 1, seatsPerRow: 0, numAisles: 0,
                aisleWidthIn: minAisleWidthIn, usableLengthIn: 0, totalCapacity: 0
            };
        }

        const seatingLengthIn = seatingLengthFt * 12.0;
        const clampedMaxAisle = Math.max(maxAisleWidthIn, minAisleWidthIn);

        let aisleWidth = minAisleWidthIn;
        let numAisles = 2;
        let numRows = 1;
        const maxIterations = 20;

        for (let iter = 0; iter < maxIterations; iter++) {
            let totalAisleSpace = numAisles * aisleWidth;
            let usableLength = seatingLengthIn - totalAisleSpace;
            if (usableLength <= 0) usableLength = seatWidthIn;

            let seatsPerRow = Math.floor(usableLength / seatWidthIn);
            if (seatsPerRow <= 0) seatsPerRow = 1;

            let newNumRows = Math.ceil(totalOccupants / seatsPerRow);
            if (newNumRows <= 0) newNumRows = 1;

            const totalLoad = newNumRows * seatsPerRow;
            const totalEgressWidth = totalLoad * egressFactor;

            let newNumAisles = Math.ceil(totalEgressWidth / clampedMaxAisle);
            if (newNumAisles < 1) newNumAisles = 1;

            const avgWidth = totalEgressWidth / newNumAisles;
            const newAisleWidth = Math.max(minAisleWidthIn, avgWidth);

            if (newNumRows === numRows && newNumAisles === numAisles &&
                Math.abs(newAisleWidth - aisleWidth) < 0.01) {
                break;
            }

            numRows = newNumRows;
            numAisles = newNumAisles;
            aisleWidth = newAisleWidth;
        }

        // Final recalculation
        const totalAisleSpace = numAisles * aisleWidth;
        let usableLength = seatingLengthIn - totalAisleSpace;
        if (usableLength <= 0) usableLength = seatWidthIn;
        let seatsPerRow = Math.floor(usableLength / seatWidthIn);
        if (seatsPerRow <= 0) seatsPerRow = 1;
        numRows = Math.ceil(totalOccupants / seatsPerRow);
        if (numRows <= 0) numRows = 1;

        return {
            numRows,
            seatsPerRow,
            numAisles,
            aisleWidthIn: Math.round(aisleWidth * 100) / 100,
            usableLengthIn: Math.round(usableLength * 100) / 100,
            totalCapacity: seatsPerRow * numRows
        };
    }

    getStepGeometry() {
        const segments = [];

        for (let i = 0; i < this.rows.length; i++) {
            const row = this.rows[i];

            // Tread (horizontal)
            const treadStart = { x: row.x - this.treadDepthFt, z: row.z };
            const treadEnd = { x: row.x, z: row.z };
            segments.push([treadStart, treadEnd]);

            // Riser (vertical) - except for last row
            if (i < this.rows.length - 1) {
                const nextRow = this.rows[i + 1];

                // Check for tier break
                if (this.tierBreakRow > 0 && (i + 1) === this.tierBreakRow) {
                    // Walkway horizontal from current row end to next row start minus tread
                    const walkwayStart = { x: row.x, z: row.z };
                    const walkwayEnd = { x: nextRow.x - this.treadDepthFt, z: row.z };
                    segments.push([walkwayStart, walkwayEnd]);

                    // Riser up to next tier
                    const riserStart = { x: nextRow.x - this.treadDepthFt, z: row.z };
                    const riserEnd = { x: nextRow.x - this.treadDepthFt, z: nextRow.z };
                    segments.push([riserStart, riserEnd]);
                } else {
                    const riserStart = { x: row.x, z: row.z };
                    const riserEnd = { x: row.x, z: nextRow.z };
                    segments.push([riserStart, riserEnd]);
                }
            }
        }

        return segments;
    }
}
