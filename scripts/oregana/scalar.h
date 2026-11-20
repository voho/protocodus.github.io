// Each lane of the native four-pipe kernel does the same float operations as a
// single pipe. Select the original scalar kernels for a JavaScript runtime.
#include "DspMath.h"
#undef OREGANA_FOUR
