#pragma once

#include "Math.h"
#include "Score.h"

namespace MikuMikuWorld
{
	enum class SpriteLayer : uint8_t
	{
		UNDER_NOTE_EFFECT = 6
	};
}

namespace MikuMikuWorld::Engine
{
	// 60 轨中心 = 30（原 12 轨为 6）。
	static inline float laneToLeft(float lane)
	{
		return lane - 30;
	}
}
