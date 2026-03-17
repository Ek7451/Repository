/**
 * Sports field templates with standard dimensions.
 * All dimensions in feet unless otherwise noted.
 * Ported from sports_templates.py
 */

const SPORTS_TEMPLATES = {
    "Ice Hockey": {
        field_length: 200.0,
        field_width: 85.0,
        corner_radius: 28.0,
        runoff: 10.0,
        focal_x: 0.0,
        focal_y: -42.5,
        focal_z: 0.0,
        shape: "rounded_rect",
        defaults: {
            setup: { customRunoff: 10.0, focalZ: 3.5 },
            bowl: { radius: 16 },
            tier1: {
                targetCValue: 3.5,
                numRows: 15,
                firstRowDist: 10.0,
                firstRowElev: 3.0,
                treadDepth: 33,
                riserHeight: 12, // Steeper for over glass
                eyeHeight: 3.75,
                eyeSetback: 6
            }
        }
    },
    "Football": {
        field_length: 360.0,
        field_width: 160.0,
        corner_radius: 0.0,
        runoff: 25.0,
        focal_x: 0.0,
        focal_y: -80.0,
        focal_z: 0.0,
        shape: "rectangle",
        defaults: {
            setup: { customRunoff: 25.0, focalZ: 0.0 },
            bowl: { radius: 10 },
            tier1: {
                targetCValue: 4.0,
                numRows: 30,
                firstRowDist: 45.0,
                firstRowElev: 6.0, // See over players
                treadDepth: 33,
                riserHeight: 10,
                eyeHeight: 3.75,
                eyeSetback: 6
            }
        }
    },
    "Soccer": {
        field_length: 345.0,
        field_width: 222.0,
        corner_radius: 0.0,
        runoff: 20.0,
        focal_x: 0.0,
        focal_y: -111.5,
        focal_z: 0.0,
        shape: "rectangle",
        defaults: {
            setup: { customRunoff: 20.0, focalZ: 0.0 },
            bowl: { radius: 2 },
            tier1: {
                targetCValue: 3.5, // FIFA Recommendation
                numRows: 30,
                firstRowDist: 32.0,
                firstRowElev: 2.0,
                treadDepth: 33,
                riserHeight: 8,
                eyeHeight: 3.75,
                eyeSetback: 6
            }
        }
    },
    "Basketball": {
        field_length: 94.0,
        field_width: 50.0,
        corner_radius: 0.0,
        runoff: 6.5,
        focal_x: 0.0,
        focal_y: -25.0,
        focal_z: 2.5,
        shape: "rectangle",
        defaults: {
            setup: { customRunoff: 6.5, focalZ: 2.5 },
            bowl: { radius: 1 },
            tier1: {
                targetCValue: 4.0,
                numRows: 20,
                firstRowDist: 20.0, // Courtside
                firstRowElev: 2.0,
                treadDepth: 34,
                riserHeight: 12, // Gradual start
                eyeHeight: 3.75,
                eyeSetback: 6
            }
        }
    },
    "Baseball": {
        field_radius: 325.0,
        runoff: 60.0,
        focal_x: 0.0,
        focal_y: 0.0,
        focal_z: 0.0,
        shape: "arc",
        arc_angle: 90.0,
        defaults: {
            setup: { customRunoff: 60.0, focalZ: 0.0 },
            bowl: { radius: 0 },
            tier1: {
                targetCValue: 5.0,
                numRows: 25,
                firstRowDist: 50.0, // Saftey/Backstop
                firstRowElev: 3.0,
                treadDepth: 33,
                riserHeight: 8,
                eyeHeight: 3.75,
                eyeSetback: 6
            }
        }
    },
    "Track": {
        straight_length: 580.5,
        field_width: 303.6,
        corner_radius: 120.0,
        runoff: 10.0,
        focal_x: 0.0,
        focal_y: 0.0,
        focal_z: 0.0,
        shape: "oval",
        defaults: {
            setup: { customRunoff: 10.0, focalZ: 0.0 },
            bowl: { type: 'Sides', radius: 100 },
            tier1: {
                targetCValue: 3.0,
                numRows: 20,
                firstRowDist: 175.0,
                firstRowElev: 3.0,
                treadDepth: 33,
                riserHeight: 8,
                eyeHeight: 3.75,
                eyeSetback: 6
            }
        }
    },
    "Concert": {
        field_length: 60.0,
        field_width: 40.0,
        corner_radius: 0.0,
        runoff: 30.0,
        focal_x: 0.0,
        focal_y: -20.0,
        focal_z: 5.0,
        shape: "rectangle",
        defaults: {
            setup: { customRunoff: 15.0, focalZ: 5.0 }, // Stage Height
            bowl: { radius: 0 },
            tier1: {
                targetCValue: 2.5,
                numRows: 40,
                firstRowDist: 15.0,
                firstRowElev: 0.0, // Floor seating
                treadDepth: 33,
                riserHeight: 2, // Very flat
                eyeHeight: 3.75,
                eyeSetback: 6
            }
        }
    }
};

const FOCAL_X_MAX_FT = 100.0;
export const FOCAL_X_STEP_FT = 0.1;

function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function resolveTemplateFieldEdgeAnchorYFt(template) {
    const explicitAnchor = toFiniteNumber(template?.focal_y);
    if (explicitAnchor !== null && explicitAnchor !== 0) {
        return explicitAnchor;
    }

    const fieldWidth = toFiniteNumber(template?.field_width);
    if (fieldWidth !== null && fieldWidth > 0) {
        return -(fieldWidth / 2);
    }

    return explicitAnchor ?? 0;
}

export function resolveTemplateFocalXBoundsFt(template) {
    const explicitAnchor = toFiniteNumber(template?.focal_y);
    const fieldWidth = toFiniteNumber(template?.field_width);
    const fieldRadius = toFiniteNumber(template?.field_radius);

    let min = 0;
    if (explicitAnchor !== null && explicitAnchor !== 0) {
        min = -Math.abs(explicitAnchor);
    } else if (fieldWidth !== null && fieldWidth > 0) {
        min = -(fieldWidth / 2);
    } else if (fieldRadius !== null && fieldRadius > 0) {
        min = -fieldRadius;
    }

    return {
        min,
        max: FOCAL_X_MAX_FT
    };
}

export function clampTemplateFocalXFt(template, focalX = 0) {
    const { min, max } = resolveTemplateFocalXBoundsFt(template);
    const numericValue = toFiniteNumber(focalX) ?? 0;
    return Math.max(min, Math.min(max, numericValue));
}

export function resolvePlanFocalYFt(template, focalX = 0) {
    const anchorY = resolveTemplateFieldEdgeAnchorYFt(template);
    return anchorY - clampTemplateFocalXFt(template, focalX);
}

export function getTemplate(sportName) {
    return SPORTS_TEMPLATES[sportName] || null;
}

export function getSportNames() {
    return Object.keys(SPORTS_TEMPLATES);
}
