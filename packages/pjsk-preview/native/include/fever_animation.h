#pragma once
#include <cmath>
#include <cstddef>
#include <iterator>

namespace fever {
struct Key { float time; float coefficients[4]; };
struct Curve { const Key* keys; std::size_t count; };
struct Glyph {
    const char* texture;
    float parentX, parentY, scaleX, scaleY, pixelsPerUnit;
    float rectX, rectY, width, height;
    Curve x, y, alpha;
};
struct Beam {
    float parentX, parentY, rotation, pixelsPerUnit;
    float r, g, b, a;
    Curve x, y, scaleX, scaleY, active;
};
struct FlashLayer {
    float rootY, mirror, maskX, maskY, scaleX, scaleY, rotation;
    Curve maskPositionX, maskPositionY, x, y, alpha, active;
};
struct FlashPose { float maskX, maskY, x, y, alpha; };
struct Clip { float duration; const Glyph* glyphs; std::size_t count; const Beam* beams; std::size_t beamCount; };
struct Pose { float x, y, scaleX, scaleY, alpha; };
struct Viewport { float width, height, pixelsPerUnit; };
// CameraSizeUpdater 默认 1920×1080 / 108 PPU；窄画面按宽度扩展可见高度。
inline Viewport viewport(float width, float height)
{
    if (!(width > 0) || !(height > 0)) return {};
    const float scale = width / 1920.0f < height / 1080.0f ? width / 1920.0f : height / 1080.0f;
    return {width, height, 108.0f * scale};
}
enum class ClipId { Fever, Chance, Super, Flash };

// StreamedClip 保存每段的三次多项式；常量段自然表达阶跃，不重建切线。
inline float sample(Curve curve, float time, float fallback)
{
    if (!curve.count || !std::isfinite(time)) return fallback;
    if (time < curve.keys[0].time) return curve.keys[0].coefficients[3];
    std::size_t index = 0;
    while (index + 1 < curve.count && curve.keys[index + 1].time <= time) ++index;
    const Key& key = curve.keys[index];
    if (index + 1 == curve.count) return key.coefficients[3];
    const float t = time - key.time;
    const float* c = key.coefficients;
    return ((c[0] * t + c[1]) * t + c[2]) * t + c[3];
}
}

#include "../generated/fever_animation_data.h"
#include "../generated/fever_animation_standard.h"
#include "../generated/fever_flash_data.h"

namespace fever {
inline FlashPose flashLayerPose(std::size_t index, float time, int profile)
{
    if (profile != 0 || index >= std::size(FlashLayers) || !std::isfinite(time) || time < 0 || time >= standard::FlashClip.duration) return {};
    const auto& layer = FlashLayers[index];
    return {sample(layer.maskPositionX, time, layer.maskX), sample(layer.maskPositionY, time, layer.maskY),
            sample(layer.x, time, 0), sample(layer.y, time, 0),
            sample(layer.alpha, time, 0) * sample(layer.active, time, 0)};
}

inline const Clip& clip(ClipId id, int profile = 1)
{
    if (profile == 0) {
        if (id == ClipId::Flash) return standard::FlashClip;
        if (id == ClipId::Chance) return standard::ChanceClip;
        if (id == ClipId::Super) return standard::SuperClip;
        return standard::FeverClip;
    }
    if (id == ClipId::Flash) return FlashClip;
    if (id == ClipId::Chance) return ChanceClip;
    if (id == ClipId::Super) return SuperClip;
    return FeverClip;
}

inline Pose beamPose(ClipId id, std::size_t index, float time, int profile = 0)
{
    const auto& animation = clip(id, profile);
    if (index >= animation.beamCount || !std::isfinite(time)) return {};
    const auto& beam = animation.beams[index];
    const float alpha = time < 0 || time >= animation.duration ? 0 : sample(beam.active, time, 0);
    return {beam.parentX + sample(beam.x, time, 0), beam.parentY + sample(beam.y, time, 0),
            sample(beam.scaleX, time, 1), sample(beam.scaleY, time, 1), alpha * beam.a};
}

inline Pose pose(ClipId id, std::size_t index, float time, int profile = 1)
{
    const Clip& animation = clip(id, profile);
    if (index >= animation.count || !std::isfinite(time)) return {};
    const Glyph& glyph = animation.glyphs[index];
    const float alpha = time < 0 || time >= animation.duration ? 0 : sample(glyph.alpha, time, 0);
    return {glyph.parentX + sample(glyph.x, time, 0) * glyph.scaleX,
            glyph.parentY + sample(glyph.y, time, 0) * glyph.scaleY,
            glyph.scaleX, glyph.scaleY, alpha};
}
}
