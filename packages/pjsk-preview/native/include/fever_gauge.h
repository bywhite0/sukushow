#pragma once
#include <array>
#include <algorithm>
#include <cmath>

namespace fever::gauge {
constexpr float feverThreshold = 0.70f;
constexpr float feverRate = 0.882f;
constexpr float superRate = 1.0f;
constexpr float materialAlpha = 0.5019608f;

struct Point { float x, y; };
// fever_lane_mesh + roop(-2.91) + FeverGauge_R_color(-0.19,3.15)，左臂镜像。
inline constexpr std::array<Point, 4> rightMesh{{
    {-1.552f, 4.10f}, {-1.72f, 4.10f}, {-9.78f, -5.76f}, {-10.67f, -5.76f},
}};
inline constexpr std::array<Point, 4> leftMesh{{
    {1.552f, 4.10f}, {1.72f, 4.10f}, {9.78f, -5.76f}, {10.67f, -5.76f},
}};

inline float finite01(float value)
{
    return std::isfinite(value) ? std::clamp(value, 0.0f, 1.0f) : 0.0f;
}

inline float alignedDistance(float x, float y, float topUnit, float baseDistance)
{
    const float t = std::clamp((4.10f - y) / 9.86f, 0.0f, 1.0f);
    const float inner = 1.552f + (9.78f - 1.552f) * t;
    const float widthUnit = topUnit + (108.0f - topUnit) * t;
    return baseDistance + (std::abs(x) - inner) * widthUnit;
}inline float fill(float progress)
{
    const float p = finite01(progress);
    const float fever = std::clamp(p / feverThreshold, 0.0f, 1.0f);
    const float super = std::clamp((p - feverThreshold) / (1.0f - feverThreshold), 0.0f, 1.0f);
    return fever * feverRate + super * (superRate - feverRate);
}

inline bool visible(float progress, float feverLocalSec)
{
    return std::isfinite(progress) && progress > 0.0f && feverLocalSec < 0.0f;
}

inline float colorOffsetX(float progress)
{
    return std::isfinite(progress) && progress > feverThreshold ? 0.5f : 0.0f;
}

inline bool flashVisible(float progress, bool superEnabled, float localSec, int profile)
{
    return profile == 0 && superEnabled && colorOffsetX(progress) > 0 &&
        std::isfinite(localSec) && localSec >= 0.0f && localSec < 0.8333333f;
}
}
