#include "fever_animation.h"
#include <cassert>
#include <cmath>
#include <limits>

int main()
{
    using namespace fever;
    const Key keys[] = {{0, {2, -3, 0, 1}}, {1, {0, 0, 0, 0}}};
    const Curve curve{keys, 2};
    assert(std::abs(sample(curve, 0.25f, 9) - 0.84375f) < 0.00001f);
    assert(sample(curve, -1, 9) == 1);
    assert(sample(curve, 2, 9) == 0);
    assert(sample({nullptr, 0}, 0, 9) == 9);
    assert(sample(curve, std::numeric_limits<float>::quiet_NaN(), 9) == 9);
    assert(clip(ClipId::Fever, 0).beamCount == 2);
    assert(clip(ClipId::Fever, 1).beamCount == 0);
    assert(beamPose(ClipId::Fever, 0, 0.0f).alpha == 0);
    assert(beamPose(ClipId::Fever, 0, 0.25f).alpha > 0);
    assert(beamPose(ClipId::Fever, 0, 1.0f).alpha == 0);
    assert(clip(ClipId::Flash, 0).beamCount == 2);
    assert(clip(ClipId::Flash, 1).beamCount == 0);
    assert(beamPose(ClipId::Flash, 0, 0).alpha == 0);
    assert(std::abs(beamPose(ClipId::Flash, 0, .25f).alpha - .5019608f) < .00001f);
    assert(beamPose(ClipId::Flash, 0, 1).alpha == 0);
    assert(flashLayerPose(0, 0, 0).alpha == 0);
    assert(flashLayerPose(0, .25f, 1).alpha == 0);
    assert(flashLayerPose(0, .25f, 0).alpha > 0);
    assert(flashLayerPose(0, 1, 0).alpha == 0);
    const auto projection = viewport(960, 540);
    assert(projection.pixelsPerUnit == 54);
    assert(projection.width == 960 && projection.height == 540);
    assert(viewport(540, 960).pixelsPerUnit == 30.375f);
    assert(viewport(0, 0).pixelsPerUnit == 0);
    assert(pose(ClipId::Fever, 99, 0).alpha == 0);
    const auto first = pose(ClipId::Fever, 0, 0.0f);
    const auto peak = pose(ClipId::Fever, 0, 0.25f);
    assert(std::abs(first.x - (-1.06f)) < 0.0001f);
    assert(std::abs(peak.x - (-1.66f)) < 0.0001f);
    assert(first.alpha == 0 && peak.alpha == 1);
    assert(std::abs(peak.y - 0.076f) < 0.0001f);
    assert(pose(ClipId::Fever, 0, 2.0f).alpha == 0);
    assert(pose(ClipId::Super, 0, 1.0f).alpha == 0);
    assert(pose(ClipId::Chance, 0, 2.0f).alpha == 0);
    assert(std::abs(pose(ClipId::Chance, 0, 0.25f).scaleX - 0.9f) < 0.0001f);
    const auto rewind = pose(ClipId::Fever, 0, 0.25f);
    assert(peak.x == rewind.x && peak.alpha == rewind.alpha);
    assert(pose(ClipId::Fever, 0, -1.0f).alpha == 0);

    using namespace fever::gauge;
    assert(std::abs(fill(0.35f) - 0.441f) < 0.00001f);
    assert(std::abs(fill(0.70f) - 0.882f) < 0.00001f);
    assert(std::abs(fill(0.85f) - 0.941f) < 0.00001f);
    assert(fill(0.0f) == 0.0f && fill(1.0f) == 1.0f);
    assert(fill(-1.0f) == 0.0f && fill(2.0f) == 1.0f);
    assert(fill(std::numeric_limits<float>::quiet_NaN()) == 0.0f);
    assert(visible(0.01f, -1.0f) && !visible(0.0f, -1.0f));
    assert(visible(0.70f, -1.0f) && !visible(0.70f, 0.0f));
    const auto& top = rightMesh[0];
    const auto& bottom = rightMesh[2];
    assert(std::abs(top.x - (-1.552f)) < 0.00001f);
    assert(std::abs(top.y - 4.10f) < 0.00001f);
    assert(std::abs(bottom.x - (-9.78f)) < 0.00001f);
    assert(std::abs(bottom.y - (-5.76f)) < 0.00001f);
    assert(std::abs(leftMesh[0].x + rightMesh[0].x) < 0.00001f);
    assert(std::abs((270.0f - top.y * viewport(960, 540).pixelsPerUnit) - 48.6f) < 0.0001f);
    assert(colorOffsetX(0.70f) == 0.0f && colorOffsetX(0.701f) == 0.5f);
    assert(!flashVisible(0.70f, true, 0.25f, 0));
    assert(flashVisible(0.85f, true, 0.25f, 0));
    assert(!flashVisible(0.85f, false, 0.25f, 0));
    assert(!flashVisible(0.85f, true, 1.0f, 0));
    assert(!flashVisible(0.85f, true, 0.25f, 1));
    assert(std::abs(colorOffsetY(0.0f) - (-0.14f)) < 0.00001f);
    assert(std::abs(colorOffsetY(0.75f) - (-0.64f)) < 0.00001f);
    assert(std::abs(colorOffsetY(1.5f) - (-0.14f)) < 0.00001f);
    assert(std::abs(alignedDistance(1.552f, 4.10f, 54, 100) - 100) < .0001f);
    assert(std::abs(alignedDistance(-1.72f, 4.10f, 54, 100) - 109.072f) < .0001f);
    assert(std::abs(alignedDistance(9.78f, -5.76f, 108, 500) - 500) < .0001f);
    assert(std::abs(alignedDistance(10.67f, -5.76f, 108, 500) - 596.12f) < .0001f);
}
